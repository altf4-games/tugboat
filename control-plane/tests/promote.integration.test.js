import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImage } from "../src/buildImage.js";
import { hostnameFor } from "../src/dockerLabels.js";
import { startTraefik, stopTraefik } from "../src/traefikController.js";
import { promote } from "../src/promote.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleAppDir = path.resolve(__dirname, "../../sample-app");

async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function startContinuousPolling(url, intervalMs = 50) {
  const stats = { total: 0, failed: 0, failures: [] };
  let stopped = false;

  async function tick() {
    if (stopped) return;
    stats.total += 1;
    try {
      const res = await fetch(url);
      if (res.status !== 200 || (await res.text()) !== "ok") {
        stats.failed += 1;
        stats.failures.push(`status=${res.status}`);
      }
    } catch (err) {
      stats.failed += 1;
      stats.failures.push(err.message);
    }
    if (!stopped) setTimeout(tick, intervalMs);
  }

  tick();

  return {
    stats,
    stop: () => {
      stopped = true;
    },
  };
}

const repo = "tugboat-phase5-test";
const traefikContainerName = `tugboat-traefik-promote-${Date.now()}`;

let httpPort;
let apiPort;
let traefikApiUrl;
let image1Tag;
let image2Tag;
let productionContainer;

describe("Phase 5 integration: blue-green production promote", () => {
  beforeAll(async () => {
    image1Tag = (await buildImage({ repo, sha: "promote-1", appPath: sampleAppDir })).imageTag;
    image2Tag = (await buildImage({ repo, sha: "promote-2", appPath: sampleAppDir })).imageTag;
    httpPort = await getFreePort();
    apiPort = await getFreePort();
    traefikApiUrl = `http://localhost:${apiPort}`;
    startTraefik({ containerName: traefikContainerName, httpPort, apiPort });
  }, 180_000);

  afterAll(() => {
    if (productionContainer) {
      try {
        execFileSync("docker", ["rm", "-f", productionContainer.containerName]);
      } catch {
        // best-effort cleanup
      }
    }
    stopTraefik(traefikContainerName);
  });

  it(
    "promotes twice in a row with zero dropped requests against the production route",
    async () => {
      const productionUrl = `http://${hostnameFor({ branch: "production" })}:${httpPort}/health`;

      productionContainer = await promote({
        imageTag: image1Tag,
        repo,
        port: 3000,
        traefikContainerName,
        traefikApiUrl,
      });

      const initialCheck = await fetch(productionUrl);
      expect(initialCheck.status).toBe(200);
      expect(await initialCheck.text()).toBe("ok");

      const polling = startContinuousPolling(productionUrl);

      // let the poller establish a baseline before the swap starts
      await new Promise((resolve) => setTimeout(resolve, 500));

      const previousContainerName = productionContainer.containerName;
      productionContainer = await promote({
        imageTag: image2Tag,
        repo,
        port: 3000,
        traefikContainerName,
        traefikApiUrl,
        previousContainerName,
      });

      // keep polling a bit after the swap completes too
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      polling.stop();

      expect(polling.stats.total).toBeGreaterThan(10);
      expect(polling.stats.failures).toEqual([]);
      expect(polling.stats.failed).toBe(0);

      const oldContainerStillExists = execFileSync("docker", [
        "ps",
        "-a",
        "--filter",
        `name=^${previousContainerName}$`,
        "--format",
        "{{.Names}}",
      ])
        .toString()
        .trim();
      expect(oldContainerStillExists).toBe("");
    },
    120_000,
  );
});
