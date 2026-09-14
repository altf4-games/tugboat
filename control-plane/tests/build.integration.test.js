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
import { imageTagFor } from "../src/buildImage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const sampleAppDir = path.join(repoRoot, "sample-app");

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

describe("Phase 2 integration: real push triggers a real pack build of a real, runnable image", () => {
  it(
    "produces and runs a real tagged image after a real GitHub push webhook",
    async () => {
      const secret = crypto.randomBytes(32).toString("hex");
      const repo = repoFullName();
      const token = githubToken();
      const branchName = `build-test/${Date.now()}`;

      let resolveBuildDone;
      let rejectBuildDone;
      const buildDone = new Promise((resolve, reject) => {
        resolveBuildDone = resolve;
        rejectBuildDone = reject;
      });

      const buildHandler = createBuildOnPushHandler({
        appPath: sampleAppDir,
        onBuildComplete: (result) => resolveBuildDone(result),
        onBuildError: (err) => rejectBuildDone(err),
      });

      const app = createWebhookServer({
        secret,
        onPush: (parsed, rawPayload) => {
          // This webhook fires for every push on the repo, including ones
          // from other tests/branches; only build our own branch's push.
          if (parsed.branch !== branchName) return;
          buildHandler(parsed, rawPayload);
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
      let imageTag;
      let containerName;

      try {
        const tunnelUrl = await waitForTunnelUrl(tunnel, 30_000);
        await new Promise((resolve) => setTimeout(resolve, 5_000));

        const hook = await githubApi(token, "POST", `/repos/${repo}/hooks`, {
          name: "web",
          active: true,
          events: ["push"],
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
        const markerFile = path.join(markerDir, "build-trigger.txt");
        fs.writeFileSync(markerFile, `Phase 2 build smoke test at ${new Date().toISOString()}\n`);
        git(["add", markerFile]);
        git(["commit", "-m", `test: phase 2 build smoke trigger (${branchName})`]);
        const commitSha = git(["rev-parse", "HEAD"]);
        git(["push", "origin", branchName]);
        branchPushed = true;

        const result = await Promise.race([
          buildDone,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timed out waiting for build to complete")), 180_000),
          ),
        ]);

        imageTag = result.imageTag;
        expect(imageTag).toBe(imageTagFor({ repo, sha: commitSha }));

        const inspected = JSON.parse(
          execFileSync("docker", ["image", "inspect", imageTag]).toString(),
        );
        expect(inspected).toHaveLength(1);
        expect(inspected[0].RepoTags).toContain(imageTag);

        containerName = `tugboat-phase2-${Date.now()}`;
        execFileSync("docker", [
          "run",
          "-d",
          "--rm",
          "-p",
          "0:3000",
          "--name",
          containerName,
          imageTag,
        ]);

        const containerPort = JSON.parse(
          execFileSync("docker", ["inspect", containerName]).toString(),
        )[0].NetworkSettings.Ports["3000/tcp"][0].HostPort;

        await new Promise((resolve) => setTimeout(resolve, 2_000));

        const response = await fetch(`http://localhost:${containerPort}/health`);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok");
      } finally {
        if (containerName) {
          try {
            execFileSync("docker", ["stop", containerName]);
          } catch {
            // best-effort cleanup
          }
        }

        tunnel.kill();
        await new Promise((resolve) => server.close(resolve));

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
