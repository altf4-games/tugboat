import { describe, it, expect, afterAll } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWebhookServer } from "../src/webhookServer.js";
import { extractTrycloudflareUrl } from "../src/cloudflaredUrl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
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

describe("Phase 1 integration: real GitHub push webhook delivery", () => {
  it(
    "receives and correctly parses a real push webhook fired by a real GitHub push, via a real cloudflared tunnel",
    async () => {
      const secret = crypto.randomBytes(32).toString("hex");
      const repo = repoFullName();
      const token = githubToken();
      const branchName = `webhook-test/${Date.now()}`;

      const receivedPushes = [];
      const receivedRawPayloads = [];
      let resolveFirstPush;
      const firstPush = new Promise((resolve) => {
        resolveFirstPush = resolve;
      });

      const app = createWebhookServer({
        secret,
        onPush: (parsed, rawPayload) => {
          receivedPushes.push(parsed);
          receivedRawPayloads.push(rawPayload);
          resolveFirstPush();
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

      try {
        const tunnelUrl = await waitForTunnelUrl(tunnel, 30_000);

        // GitHub's resolvers see the fresh trycloudflare.com subdomain
        // immediately (this machine's local DNS may lag behind and is not
        // a reliable readiness signal); give the tunnel edge a brief moment
        // to finish wiring up before registering the webhook.
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
        const markerFile = path.join(markerDir, "trigger.txt");
        fs.writeFileSync(markerFile, `Phase 1 webhook smoke test at ${new Date().toISOString()}\n`);
        git(["add", markerFile]);
        git(["commit", "-m", `test: phase 1 webhook smoke trigger (${branchName})`]);
        const commitSha = git(["rev-parse", "HEAD"]);
        git(["push", "origin", branchName]);
        branchPushed = true;

        await Promise.race([
          firstPush,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Timed out waiting for webhook delivery")), 90_000),
          ),
        ]);

        expect(receivedPushes).toHaveLength(1);
        expect(receivedPushes[0].repo).toBe(repo);
        expect(receivedPushes[0].branch).toBe(branchName);
        expect(receivedPushes[0].sha).toBe(commitSha);

        // Captured once and kept frozen: pushEvent.unit.test.js asserts
        // against specific values in this file, so later integration runs
        // must not overwrite it with a different branch/sha.
        const fixturePath = path.join(fixturesDir, "github-push-event.captured.json");
        if (!fs.existsSync(fixturePath)) {
          fs.mkdirSync(fixturesDir, { recursive: true });
          fs.writeFileSync(fixturePath, JSON.stringify(receivedRawPayloads[0], null, 2) + "\n");
        }
      } finally {
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
    180_000,
  );
});
