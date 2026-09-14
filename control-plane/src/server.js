import express from "express";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDb,
  listDeployments,
  getDeployment,
  deleteDeployment,
  createProject,
  getProjectByRepo,
  getProjectById,
  listProjects,
  deleteProject,
  setProjectHookId,
  setProjectRootDirectory,
} from "./db.js";
import { createSession, getSession, destroySession } from "./session.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchGithubUser,
  fetchGithubRepos,
} from "./githubOAuth.js";
import { createMultiProjectWebhookRouter } from "./multiProjectWebhook.js";
import { createProjectPushHandler } from "./projectPipeline.js";
import { isDeployInFlight } from "./deployLock.js";
import { createDeleteTeardownHandler } from "./onDeleteTeardown.js";
import { ensureNetwork, startTraefik, stopTraefik } from "./traefikController.js";
import { startTunnel, stopTunnel } from "./tunnelManager.js";
import { stopAppContainer } from "./runAppContainer.js";
import { getPreview, removePreview } from "./previewRegistry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadEnvFile(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
}
loadEnvFile(path.resolve(__dirname, "../.env"));

const PORT = Number(process.env.PORT || 4000);
const TRAEFIK_HTTP_PORT = Number(process.env.TRAEFIK_HTTP_PORT || 8000);
const TRAEFIK_API_PORT = Number(process.env.TRAEFIK_API_PORT || 8081);
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
const SESSION_COOKIE = "tugboat_session";
const TRAEFIK_CONTAINER_NAME = "tugboat-traefik";

if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
  console.warn(
    "[tugboat] GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not set — login will not work " +
      "until control-plane/.env has real values. See README for setup.",
  );
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((pair) => {
      const eq = pair.indexOf("=");
      return [pair.slice(0, eq).trim(), decodeURIComponent(pair.slice(eq + 1))];
    }),
  );
}

async function main() {
  const db = openDb();
  const liveBuilds = new Map();
  const pendingOAuthStates = new Set();
  let publicUrl; // set once the control plane's own tunnel is up, below

  console.log("[tugboat] ensuring Docker network...");
  ensureNetwork();

  console.log("[tugboat] starting Traefik...");
  stopTraefik(TRAEFIK_CONTAINER_NAME); // clean slate on restart
  startTraefik({
    containerName: TRAEFIK_CONTAINER_NAME,
    httpPort: TRAEFIK_HTTP_PORT,
    apiPort: TRAEFIK_API_PORT,
  });
  const traefikApiUrl = `http://localhost:${TRAEFIK_API_PORT}`;

  const app = express();

  // --- webhook intake (mounted before express.json(); see multiProjectWebhook.js) ---
  const pushHandler = createProjectPushHandler({
    db,
    liveBuilds,
    traefikContainerName: TRAEFIK_CONTAINER_NAME,
    traefikApiUrl,
  });
  const deleteHandler = createDeleteTeardownHandler();

  app.use(
    "/webhook",
    createMultiProjectWebhookRouter({
      getProjectById: (id) => getProjectById(db, id),
      onPush: (parsed, project) => pushHandler(parsed, project),
      onDelete: (parsed, project) => deleteHandler(parsed),
    }),
  );

  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../public")));

  function requireAuth(req, res, next) {
    const user = getSession(db, parseCookies(req)[SESSION_COOKIE], SESSION_SECRET);
    if (!user) return res.status(401).json({ error: "not signed in" });
    req.user = user;
    next();
  }

  // --- auth ---
  app.get("/auth/login", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    pendingOAuthStates.add(state);
    res.redirect(
      buildAuthorizeUrl({
        clientId: GITHUB_CLIENT_ID,
        redirectUri: `http://localhost:${PORT}/auth/callback`,
        state,
      }),
    );
  });

  app.get("/auth/callback", async (req, res) => {
    const { code, state } = req.query;
    if (!state || !pendingOAuthStates.has(state)) {
      return res.status(400).send("invalid OAuth state");
    }
    pendingOAuthStates.delete(state);

    try {
      const token = await exchangeCodeForToken({
        clientId: GITHUB_CLIENT_ID,
        clientSecret: GITHUB_CLIENT_SECRET,
        code,
        redirectUri: `http://localhost:${PORT}/auth/callback`,
      });
      const ghUser = await fetchGithubUser(token);

      const cookieValue = createSession(
        db,
        { login: ghUser.login, avatarUrl: ghUser.avatar_url, token },
        SESSION_SECRET,
      );
      // Persisted in SQLite (see session.js) and long-lived, so neither a
      // page reload nor a server restart during development forces
      // signing in again.
      res.cookie(SESSION_COOKIE, cookieValue, {
        httpOnly: true,
        sameSite: "lax",
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });
      res.redirect("/");
    } catch (err) {
      res.status(500).send(`OAuth login failed: ${err.message}`);
    }
  });

  app.post("/auth/logout", (req, res) => {
    destroySession(db, parseCookies(req)[SESSION_COOKIE]);
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  app.get("/api/me", requireAuth, (req, res) => {
    res.json({ login: req.user.login, avatarUrl: req.user.avatarUrl });
  });

  // --- repos & projects ---
  app.get("/api/repos", requireAuth, async (req, res) => {
    try {
      const repos = await fetchGithubRepos(req.user.token);
      res.json(
        repos.map((r) => ({
          fullName: r.full_name,
          private: r.private,
          defaultBranch: r.default_branch,
          updatedAt: r.updated_at,
        })),
      );
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get("/api/projects", requireAuth, (req, res) => {
    res.json(
      listProjects(db).map((p) => ({
        id: p.id,
        repo: p.repo,
        ownerLogin: p.owner_login,
        defaultBranch: p.default_branch,
        rootDirectory: p.root_directory,
        createdAt: p.created_at,
      })),
    );
  });

  app.post("/api/projects", requireAuth, async (req, res) => {
    const { repo, rootDirectory } = req.body;
    if (!repo || !repo.includes("/")) {
      return res.status(400).json({ error: "repo must be like owner/name" });
    }
    if (!publicUrl) {
      return res
        .status(503)
        .json({ error: "control plane tunnel isn't ready yet — try again in a few seconds" });
    }

    try {
      const repoRes = await fetch(`https://api.github.com/repos/${repo}`, {
        headers: {
          Authorization: `Bearer ${req.user.token}`,
          Accept: "application/vnd.github+json",
        },
      });
      if (!repoRes.ok) {
        return res.status(404).json({ error: `GitHub repo not found or not accessible: ${repo}` });
      }
      const repoInfo = await repoRes.json();

      const webhookSecret = crypto.randomBytes(32).toString("hex");
      const projectId = createProject(db, {
        repo: repoInfo.full_name,
        ownerLogin: repoInfo.owner.login,
        defaultBranch: repoInfo.default_branch,
        cloneUrl: repoInfo.clone_url,
        hookId: null,
        accessToken: req.user.token,
        webhookSecret,
        rootDirectory: (rootDirectory || "").trim().replace(/^\/+|\/+$/g, ""),
      });

      const webhookUrl = `${publicUrl}/webhook/github/${projectId}`;
      const hookRes = await fetch(`https://api.github.com/repos/${repo}/hooks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${req.user.token}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          name: "web",
          active: true,
          events: ["push", "delete"],
          config: {
            url: webhookUrl,
            content_type: "json",
            secret: webhookSecret,
            insecure_ssl: "0",
          },
        }),
      });
      if (!hookRes.ok) {
        deleteProject(db, repoInfo.full_name);
        return res.status(502).json({ error: `Failed to create GitHub webhook: ${await hookRes.text()}` });
      }
      const hook = await hookRes.json();
      setProjectHookId(db, projectId, hook.id);

      res.json({ id: projectId, repo: repoInfo.full_name });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/projects/:owner/:name", requireAuth, async (req, res) => {
    const repo = `${req.params.owner}/${req.params.name}`;
    const project = getProjectByRepo(db, repo);
    if (!project) return res.status(404).json({ error: "not linked" });

    if (project.hook_id) {
      await fetch(`https://api.github.com/repos/${repo}/hooks/${project.hook_id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${req.user.token}`,
          Accept: "application/vnd.github+json",
        },
      }).catch(() => {});
    }

    deleteProject(db, repo);
    res.json({ ok: true });
  });

  app.patch("/api/projects/:owner/:name", requireAuth, (req, res) => {
    const repo = `${req.params.owner}/${req.params.name}`;
    const project = getProjectByRepo(db, repo);
    if (!project) return res.status(404).json({ error: "not linked" });

    if (typeof req.body.rootDirectory === "string") {
      setProjectRootDirectory(db, repo, req.body.rootDirectory.trim().replace(/^\/+|\/+$/g, ""));
    }
    res.json(getProjectByRepo(db, repo));
  });

  // Deploy on demand — the current HEAD of a branch, with no new commit
  // needed. Reuses the exact same pipeline a real webhook push triggers:
  // this just synthesizes the push event from GitHub's own "latest commit
  // on this branch" API instead of waiting for one to arrive.
  app.post("/api/projects/:owner/:name/deploy", requireAuth, async (req, res) => {
    const repo = `${req.params.owner}/${req.params.name}`;
    const project = getProjectByRepo(db, repo);
    if (!project) return res.status(404).json({ error: "not linked" });

    const branch = req.body?.branch || project.default_branch;

    try {
      const commitRes = await fetch(
        `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`,
        {
          headers: {
            Authorization: `Bearer ${req.user.token}`,
            Accept: "application/vnd.github+json",
          },
        },
      );
      if (!commitRes.ok) {
        return res.status(404).json({ error: `Branch not found: ${branch}` });
      }
      const commit = await commitRes.json();

      if (isDeployInFlight({ repo, branch })) {
        return res
          .status(409)
          .json({ error: `A deployment for ${branch} is already in progress` });
      }

      pushHandler({ repo, branch, sha: commit.sha }, project);
      res.json({ ok: true, branch, sha: commit.sha });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- deployments ---
  app.get("/api/deployments", requireAuth, (req, res) => {
    res.json(listDeployments(db, { repo: req.query.repo }));
  });

  app.delete("/api/deployments/:id", requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const deployment = getDeployment(db, id);
    if (!deployment) return res.status(404).json({ error: "not found" });
    if (deployment.is_production) {
      return res.status(400).json({
        error: "Can't delete the current production deployment — promote a different one first.",
      });
    }

    // Only tear down real infra if this deployment is still the one
    // actually registered as the branch's live preview; an older,
    // already-superseded deployment's container was already stopped by
    // whatever replaced it.
    const containerName = `tugboat-preview-${id}`;
    const preview = getPreview({ repo: deployment.repo, branch: deployment.branch });
    if (preview && preview.containerName === containerName) {
      stopAppContainer(containerName);
      stopTunnel(preview.tunnel);
      removePreview({ repo: deployment.repo, branch: deployment.branch });
    }

    liveBuilds.delete(id);
    deleteDeployment(db, id);
    res.json({ ok: true });
  });

  app.get("/api/deployments/:id/stream", (req, res) => {
    const id = Number(req.params.id);
    const deployment = getDeployment(db, id);
    if (!deployment) return res.status(404).end();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ chunk: deployment.log })}\n\n`);

    const emitter = liveBuilds.get(id);
    if (!emitter || deployment.status !== "building") {
      res.write(`data: ${JSON.stringify({ done: true, status: deployment.status })}\n\n`);
      return res.end();
    }

    const onLog = (text) => res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
    const onDone = (result) => {
      res.write(`data: ${JSON.stringify({ done: true, status: result.status })}\n\n`);
      res.end();
    };
    emitter.on("log", onLog);
    emitter.once("done", onDone);
    req.on("close", () => {
      emitter.off("log", onLog);
      emitter.off("done", onDone);
    });
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`[tugboat] control plane listening on http://localhost:${PORT}`);

  console.log("[tugboat] opening a tunnel for GitHub to reach this server...");
  const controlPlaneTunnel = startTunnel({ localPort: PORT });
  publicUrl = await controlPlaneTunnel.url;
  console.log(`[tugboat] public webhook URL: ${publicUrl}/webhook/github/<projectId>`);

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());

  function shutdown() {
    console.log("\n[tugboat] shutting down...");
    controlPlaneTunnel.process.kill();
    stopTraefik(TRAEFIK_CONTAINER_NAME);
    server.close(() => process.exit(0));
  }
}

main().catch((err) => {
  console.error("[tugboat] fatal startup error:", err);
  process.exit(1);
});
