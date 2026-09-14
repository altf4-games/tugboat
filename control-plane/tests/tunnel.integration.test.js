import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import https from "node:https";
import dns from "node:dns";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImage } from "../src/buildImage.js";
import { runAppContainer, stopAppContainer } from "../src/runAppContainer.js";
import { startTunnel, stopTunnel } from "../src/tunnelManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleAppDir = path.resolve(__dirname, "../../sample-app");

// This machine's local resolver is unreliable for freshly-created
// *.trycloudflare.com subdomains (observed NXDOMAIN for 30s+ in Phase 3
// debugging, while Cloudflare's own resolver sees them immediately).
// Resolve explicitly via a public resolver so this test verifies real
// reachability over the real internet rather than a local DNS quirk.
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

function requestViaPublicDns(urlString) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "GET",
        lookup: lookupViaPublicDns,
      },
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

async function waitForRealReachability(urlString, { timeoutMs = 45_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastStatus;
  while (Date.now() < deadline) {
    try {
      const res = await requestViaPublicDns(urlString);
      if (res.status >= 200 && res.status < 300) return res;
      lastStatus = res.status;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out waiting for ${urlString} to respond: ${lastError?.message ?? `last status ${lastStatus}`}`,
  );
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const containerName = `tugboat-tunnel-test-${Date.now()}`;
let imageTag;
let hostPort;
let tunnel;

describe("Phase 4 integration: real Cloudflare Tunnel shareable link", () => {
  beforeAll(async () => {
    const result = await buildImage({
      repo: "tugboat-phase4-test",
      sha: "tunnel-smoke",
      appPath: sampleAppDir,
    });
    imageTag = result.imageTag;

    const run = runAppContainer({
      imageTag,
      repo: "tugboat-phase4-test",
      branch: "tunnel-smoke",
      port: 3000,
      containerName,
      publishPort: true,
    });
    hostPort = run.hostPort;
  }, 120_000);

  afterAll(() => {
    if (tunnel) stopTunnel(tunnel);
    stopAppContainer(containerName);
  });

  it(
    "gets a real, unique public link that actually reaches the running app",
    async () => {
      tunnel = startTunnel({ localPort: hostPort });
      const url = await tunnel.url;

      expect(url).toMatch(/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/);

      const res = await waitForRealReachability(`${url}/health`);
      expect(res.status).toBe(200);
      expect(res.body).toBe("ok");
    },
    90_000,
  );

  it(
    "kills the cloudflared subprocess when the deployment is torn down",
    async () => {
      const pid = tunnel.process.pid;
      expect(isProcessAlive(pid)).toBe(true);

      stopTunnel(tunnel);

      // process.kill(pid, 0) can briefly still report alive right after
      // SIGTERM is sent, before the OS finishes reaping it.
      const deadline = Date.now() + 10_000;
      while (isProcessAlive(pid) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      expect(isProcessAlive(pid)).toBe(false);

      tunnel = null;
    },
    15_000,
  );
});
