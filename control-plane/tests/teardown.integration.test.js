import { describe, it, expect } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebhookServer } from "../src/webhookServer.js";
import { extractTrycloudflareUrl } from "../src/cloudflaredUrl.js";
import { createBuildOnPushHandler } from "../src/onPushBuild.js";
import { createDeleteTeardownHandler } from "../src/onDeleteTeardown.js";
import { registerPreview, getPreview } from "../src/previewRegistry.js";
import { runAppContainer } from "../src/runAppContainer.js";
import { startTunnel } from "../src/tunnelManager.js";
import { startTraefik, stopTraefik } from "../src/traefikController.js";
import { hostnameFor } from "../src/dockerLabels.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const sampleAppDir = path.join(repoRoot, "sample-app");
const fixturesDir = path.join(__dirname, "fixtures");

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot }).toString().trim();
}

function githubToken() {
  return execFileSync("gh", ["auth", "token"]).toString().trim();
}

function repoFullName() {
  const remoteUrl = git(["remote", "get-url", "origin"]);
  const match = remoteUrl.match(/github\.com[:/](.+?)(\.git)?$/);
  if (!match) throw new Error(`Could not parse GitHub repo from remote: ${remoteUrl}`);
  return match[1];
}

async function githubApi(token, method, urlPath, body) {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 204) {
    throw new Error(`GitHub API ${method} ${urlPath} failed: ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

function waitForTunnelUrl(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for trycloudflare.com URL. Output so far:\n${buffer}`));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString();
      const url = extractTrycloudflareUrl(buffer);
      if (url) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        resolve(url);
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
  });
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(check, { timeoutMs = 20_000, intervalMs = 300 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("Timed out waiting for condition");
}

describe("Phase 8 integration: deleting a branch tears down its container, route, and tunnel", () => {
  it(
    "a real GitHub branch-delete webhook stops the container, removes the Traefik route, and kills the tunnel",
    async () => {
      const secret = crypto.randomBytes(32).toString("hex");
      const repo = repoFullName();
      const token = githubToken();
      const branchName = `teardown-test/${Date.now()}`;

      const receivedDeletes = [];
      const receivedDeleteRawPayloads = [];

      const buildHandler = createBuildOnPushHandler({
        appPath: sampleAppDir,
        onBuildComplete: async (result) => {
          const containerName = `tugboat-preview-teardown-${Date.now()}`;
          const { hostPort } = runAppContainer({
            imageTag: result.imageTag,
            repo,
            branch: branchName,
            port: 3000,
            containerName,
            publishPort: true,
          });
          const tunnel = startTunnel({ localPort: Number(hostPort) });
          await tunnel.url; // wait for the tunnel to actually be assigned
          registerPreview({ repo, branch: branchName, containerName, tunnel });
        },
        onBuildError: (err) => {
          console.error("BUILD FAILED:", err);
        },
      });

      const traefikContainerName = `tugboat-traefik-teardown-${Date.now()}`;
      let httpPort;

      const app = createWebhookServer({
        secret,
        onPush: (parsed, rawPayload) => {
          if (parsed.branch !== branchName) return;
          buildHandler(parsed, rawPayload);
        },
        onDelete: (parsed, rawPayload) => {
          if (parsed.branch !== branchName) return;
          receivedDeletes.push(parsed);
          receivedDeleteRawPayloads.push(rawPayload);
          createDeleteTeardownHandler()(parsed);
        },
      });

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      const tunnel = spawn(
        "cloudflared",
        ["tunnel", "--url", `http://localhost:${port}`, "--no-autoupdate"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );

      let hookId;
      let branchCreated = false;
      let branchPushed = false;

      httpPort = await new Promise((resolve) => {
        const s = http.createServer();
        s.listen(0, () => {
          const p = s.address().port;
          s.close(() => resolve(p));
        });
      });
      startTraefik({ containerName: traefikContainerName, httpPort });

      try {
        const tunnelUrl = await waitForTunnelUrl(tunnel, 30_000);
        await new Promise((resolve) => setTimeout(resolve, 5_000));

        const hook = await githubApi(token, "POST", `/repos/${repo}/hooks`, {
          name: "web",
          active: true,
          events: ["push", "delete"],
          config: {
            url: `${tunnelUrl}/webhook/github`,
            content_type: "json",
            secret,
            insecure_ssl: "0",
          },
        });
        hookId = hook.id;

        git(["checkout", "-b", branchName]);
        branchCreated = true;
        const markerDir = path.join(repoRoot, ".webhook-test");
        fs.mkdirSync(markerDir, { recursive: true });
        const markerFile = path.join(markerDir, "teardown-trigger.txt");
        fs.writeFileSync(markerFile, `Phase 8 teardown smoke test at ${new Date().toISOString()}\n`);
        git(["add", markerFile]);
        git(["commit", "-m", `test: phase 8 teardown smoke trigger (${branchName})`]);
        git(["push", "origin", branchName]);
        branchPushed = true;

        // Wait for the real build to finish and the preview to be registered.
        await waitUntil(() => getPreview({ repo, branch: branchName }) !== undefined, {
          timeoutMs: 120_000,
        });

        const preview = getPreview({ repo, branch: branchName });
        expect(preview).toBeDefined();

        // Confirm the container is really running before we delete anything.
        const runningBefore = execFileSync("docker", [
          "ps",
          "--filter",
          `name=^${preview.containerName}$`,
          "--format",
          "{{.Names}}",
        ])
          .toString()
          .trim();
        expect(runningBefore).toBe(preview.containerName);

        const tunnelPid = preview.tunnel.process.pid;
        expect(isProcessAlive(tunnelPid)).toBe(true);

        // Confirm the Traefik route is really live before we delete anything.
        const previewUrl = `http://${hostnameFor({ branch: branchName })}:${httpPort}/health`;
        await waitUntil(
          async () => {
            try {
              const res = await fetch(previewUrl);
              return res.status === 200;
            } catch {
              return false;
            }
          },
          { timeoutMs: 20_000 },
        );

        // Now delete the branch for real — this fires a real GitHub "delete" webhook.
        git(["push", "origin", "--delete", branchName]);
        branchPushed = false;

        await waitUntil(() => receivedDeletes.length > 0, { timeoutMs: 60_000 });

        expect(receivedDeletes[0].branch).toBe(branchName);
        expect(receivedDeletes[0].repo).toBe(repo);
        expect(receivedDeletes[0].refType).toBe("branch");

        fs.mkdirSync(fixturesDir, { recursive: true });
        const deleteFixturePath = path.join(fixturesDir, "github-delete-event.captured.json");
        if (!fs.existsSync(deleteFixturePath)) {
          fs.writeFileSync(
            deleteFixturePath,
            JSON.stringify(receivedDeleteRawPayloads[0], null, 2) + "\n",
          );
        }

        // Container actually stopped and removed.
        await waitUntil(
          () => {
            const stillThere = execFileSync("docker", [
              "ps",
              "-a",
              "--filter",
              `name=^${preview.containerName}$`,
              "--format",
              "{{.Names}}",
            ])
              .toString()
              .trim();
            return stillThere === "";
          },
          { timeoutMs: 15_000 },
        );

        // Tunnel subprocess actually killed.
        await waitUntil(() => !isProcessAlive(tunnelPid), { timeoutMs: 10_000 });

        // Route actually gone: Traefik's real-time Docker discovery drops
        // the router as soon as the container disappears (see Phase 3).
        await waitUntil(
          async () => {
            try {
              const res = await fetch(previewUrl);
              return res.status === 404;
            } catch {
              return true;
            }
          },
          { timeoutMs: 15_000 },
        );

        // Registry entry actually cleared.
        expect(getPreview({ repo, branch: branchName })).toBeUndefined();
      } finally {
        tunnel.kill();
        await new Promise((resolve) => server.close(resolve));
        stopTraefik(traefikContainerName);

        if (hookId) {
          await githubApi(token, "DELETE", `/repos/${repo}/hooks/${hookId}`).catch(() => {});
        }

        if (branchPushed) {
          try {
            git(["push", "origin", "--delete", branchName]);
          } catch {
            // best-effort cleanup
          }
        }

        if (branchCreated) {
          git(["checkout", "main"]);
          try {
            git(["branch", "-D", branchName]);
          } catch {
            // best-effort cleanup
          }
        }
      }
    },
    240_000,
  );
});
