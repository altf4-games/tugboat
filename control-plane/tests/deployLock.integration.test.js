import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import https from "node:https";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, listDeployments } from "../src/db.js";
import { createProjectPushHandler } from "../src/projectPipeline.js";
import { getPreview } from "../src/previewRegistry.js";
import { stopAppContainer } from "../src/runAppContainer.js";
import { stopTunnel } from "../src/tunnelManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot }).toString().trim();
}

function githubToken() {
  return execFileSync("gh", ["auth", "token"]).toString().trim();
}

// This machine's local resolver is unreliable for freshly-created
// *.trycloudflare.com subdomains (see the Phase 4 tunnel work); resolve
// explicitly via a public resolver so this test verifies real reachability
// rather than a local DNS quirk.
const publicResolver = new dns.Resolver();
publicResolver.setServers(["1.1.1.1"]);

function lookupViaPublicDns(hostname, options, callback) {
  publicResolver.resolve4(hostname, (err, addresses) => {
    if (err) return callback(err);
    if (options.all) {
      callback(
        null,
        addresses.map((address) => ({ address, family: 4 })),
      );
    } else {
      callback(null, addresses[0], 4);
    }
  });
}

function fetchViaPublicDns(urlString, path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, urlString);
    const req = https.request(
      { hostname: url.hostname, path: url.pathname, method: "GET", lookup: lookupViaPublicDns },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function waitForRealReachability(urlString, path, { timeoutMs = 45_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const res = await fetchViaPublicDns(urlString, path);
      if (res.status >= 200 && res.status < 300) return res;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${urlString}${path} to respond: ${lastError?.message}`);
}

function repoFullName() {
  const remoteUrl = git(["remote", "get-url", "origin"]);
  const match = remoteUrl.match(/github\.com[:/](.+?)(\.git)?$/);
  if (!match) throw new Error(`Could not parse GitHub repo from remote: ${remoteUrl}`);
  return match[1];
}

describe("Deploy lock integration: two overlapping deploys for the same branch don't race", () => {
  it(
    "running the push handler twice concurrently for the same repo+branch only actually deploys once, and the winner's preview survives",
    async () => {
      const repo = repoFullName();
      const accessToken = githubToken();
      const branch = "main";
      const sha = git(["rev-parse", "main"]);

      const project = {
        repo,
        clone_url: `https://github.com/${repo}.git`,
        access_token: accessToken,
        default_branch: "not-main-so-this-does-not-promote", // avoid touching production
        root_directory: "sample-app",
      };

      const db = openDb(":memory:");
      const liveBuilds = new Map();
      const pushHandler = createProjectPushHandler({ db, liveBuilds });

      const parsedPush = { repo, branch, sha };

      // Fire both without awaiting the first — this is exactly what
      // double-clicking "Redeploy" produces: two overlapping calls.
      await Promise.all([pushHandler(parsedPush, project), pushHandler(parsedPush, project)]);

      const deployments = listDeployments(db, { repo });
      // The second call must have been skipped by the lock before it ever
      // created a deployment row, not raced through to create a second one.
      expect(deployments).toHaveLength(1);

      const deployment = deployments[0];
      expect(deployment.status).toBe("success");
      expect(deployment.preview_url).toBeTruthy();

      // The winner's preview must still be the one actually registered —
      // proof the "skipped" call didn't tear it down out from under it.
      const preview = getPreview({ repo, branch });
      expect(preview).toBeDefined();
      expect(preview.containerName).toBe(`tugboat-preview-${deployment.id}`);

      const runningContainer = execFileSync("docker", [
        "ps",
        "--filter",
        `name=^${preview.containerName}$`,
        "--format",
        "{{.Names}}",
      ])
        .toString()
        .trim();
      expect(runningContainer).toBe(preview.containerName);

      const res = await waitForRealReachability(deployment.preview_url, "/health");
      expect(res.status).toBe(200);
      expect(res.body).toBe("ok");

      stopAppContainer(preview.containerName);
      stopTunnel(preview.tunnel);
    },
    120_000,
  );
});
