import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildImage } from "../src/buildImage.js";
import { hostnameFor } from "../src/dockerLabels.js";
import { startTraefik, stopTraefik } from "../src/traefikController.js";
import { promote } from "../src/promote.js";
import { rollback } from "../src/rollback.js";
import { getDeploymentHistory } from "../src/deploymentHistory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleAppDir = path.resolve(__dirname, "../../sample-app");

async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

function imageOfContainer(containerName) {
  return execFileSync("docker", ["inspect", "--format", "{{.Config.Image}}", containerName])
    .toString()
    .trim();
}

const repo = "tugboat-phase6-test";
const traefikContainerName = `tugboat-traefik-rollback-${Date.now()}`;

let httpPort;
let apiPort;
let traefikApiUrl;
let image1Tag;
let image2Tag;
let productionContainer;

describe("Phase 6 integration: rollback to the previously-promoted image", () => {
  beforeAll(async () => {
    image1Tag = (await buildImage({ repo, sha: "rollback-1", appPath: sampleAppDir })).imageTag;
    image2Tag = (await buildImage({ repo, sha: "rollback-2", appPath: sampleAppDir })).imageTag;
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
    "promotes twice then rolls back to the first image's real running container",
    async () => {
      const productionUrl = `http://${hostnameFor({ branch: "production" })}:${httpPort}/health`;

      productionContainer = await promote({
        imageTag: image1Tag,
        repo,
        port: 3000,
        traefikContainerName,
        traefikApiUrl,
      });

      productionContainer = await promote({
        imageTag: image2Tag,
        repo,
        port: 3000,
        traefikContainerName,
        traefikApiUrl,
        previousContainerName: productionContainer.containerName,
      });

      expect(imageOfContainer(productionContainer.containerName)).toBe(image2Tag);
      expect(getDeploymentHistory({ repo })).toHaveLength(2);

      const containerBeforeRollback = productionContainer.containerName;
      productionContainer = await rollback({
        repo,
        port: 3000,
        traefikContainerName,
        traefikApiUrl,
      });

      expect(imageOfContainer(productionContainer.containerName)).toBe(image1Tag);
      expect(getDeploymentHistory({ repo })).toHaveLength(3);

      const res = await fetch(productionUrl);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");

      const oldContainerStillExists = execFileSync("docker", [
        "ps",
        "-a",
        "--filter",
        `name=^${containerBeforeRollback}$`,
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
