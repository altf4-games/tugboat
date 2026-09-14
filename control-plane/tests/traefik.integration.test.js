import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImage } from "../src/buildImage.js";
import { hostnameFor } from "../src/dockerLabels.js";
import { startTraefik, stopTraefik } from "../src/traefikController.js";
import { runAppContainer, stopAppContainer } from "../src/runAppContainer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleAppDir = path.resolve(__dirname, "../../sample-app");

async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForHttp(url, { timeoutMs = 45_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastStatus;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      // Traefik's Docker provider polls on an interval (404 = route not
      // registered yet) and the app container itself takes a moment to
      // start listening (502/503 = route registered, backend not ready).
      // Neither is a real failure this early; keep retrying until timeout.
      if (res.status >= 200 && res.status < 300) return res;
      lastStatus = res.status;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(
    `Timed out waiting for ${url} to respond: ${lastError?.message ?? `last status ${lastStatus}`}`,
  );
}

const repo = "tugboat-phase3-test";
const traefikContainerName = `tugboat-traefik-test-${Date.now()}`;
const branch1 = `traefik-test-1-${Date.now()}`;
const branch2 = `traefik-test-2-${Date.now()}`;
const container1Name = `tugboat-app-test-1-${Date.now()}`;
const container2Name = `tugboat-app-test-2-${Date.now()}`;

let httpPort;
let imageTag;
let traefikStartedAtBeforeSecondContainer;

describe("Phase 3 integration: Traefik auto-discovers containers via Docker labels", () => {
  beforeAll(async () => {
    const result = await buildImage({ repo, sha: "traefik-smoke", appPath: sampleAppDir });
    imageTag = result.imageTag;
    httpPort = await getFreePort();
    startTraefik({ containerName: traefikContainerName, httpPort });
  }, 120_000);

  afterAll(() => {
    stopAppContainer(container1Name);
    stopAppContainer(container2Name);
    stopTraefik(traefikContainerName);
  });

  it(
    "routes a real HTTP request to a freshly started labeled container with zero manual config",
    async () => {
      runAppContainer({ imageTag, repo, branch: branch1, port: 3000, containerName: container1Name });

      const url1 = `http://${hostnameFor({ branch: branch1 })}:${httpPort}/health`;
      const res1 = await waitForHttp(url1);
      expect(res1.status).toBe(200);
      expect(await res1.text()).toBe("ok");
    },
    90_000,
  );

  it(
    "picks up a second container with zero Traefik restart, without breaking the first route",
    async () => {
      traefikStartedAtBeforeSecondContainer = JSON.parse(
        execFileSync("docker", ["inspect", traefikContainerName]).toString(),
      )[0].State.StartedAt;

      runAppContainer({ imageTag, repo, branch: branch2, port: 3000, containerName: container2Name });

      const url2 = `http://${hostnameFor({ branch: branch2 })}:${httpPort}/health`;
      const res2 = await waitForHttp(url2);
      expect(res2.status).toBe(200);
      expect(await res2.text()).toBe("ok");

      const url1 = `http://${hostnameFor({ branch: branch1 })}:${httpPort}/health`;
      const res1 = await fetch(url1);
      expect(res1.status).toBe(200);
      expect(await res1.text()).toBe("ok");

      const traefikStartedAtAfter = JSON.parse(
        execFileSync("docker", ["inspect", traefikContainerName]).toString(),
      )[0].State.StartedAt;
      expect(traefikStartedAtAfter).toBe(traefikStartedAtBeforeSecondContainer);
    },
    90_000,
  );
});
