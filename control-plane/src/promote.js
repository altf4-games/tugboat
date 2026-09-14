import { execFileSync } from "node:child_process";
import { NETWORK_NAME } from "./traefikController.js";
import { writeProductionRoute } from "./productionRoute.js";
import { sanitizeForDockerTag } from "./sanitize.js";
import { recordDeployment } from "./deploymentHistory.js";

export function startProductionContainer({ imageTag, port = 3000, containerName }) {
  execFileSync("docker", [
    "run",
    "-d",
    "--network",
    NETWORK_NAME,
    "--name",
    containerName,
    "-p",
    `0:${port}`,
    imageTag,
  ]);

  const hostPort = JSON.parse(execFileSync("docker", ["inspect", containerName]).toString())[0]
    .NetworkSettings.Ports[`${port}/tcp`][0].HostPort;

  return { containerName, hostPort };
}

export async function waitForContainerHealthy({
  hostPort,
  path = "/health",
  timeoutMs = 30_000,
  intervalMs = 300,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastStatus;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${hostPort}${path}`);
      if (res.status >= 200 && res.status < 300) return;
      lastStatus = res.status;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Container on port ${hostPort} never became healthy: ${lastError?.message ?? `last status ${lastStatus}`}`,
  );
}

export async function waitForTraefikToLoadRoute({
  traefikApiUrl,
  expectedBackendUrl,
  timeoutMs = 15_000,
  intervalMs = 200,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  let lastSeen;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${traefikApiUrl}/api/http/services/production@file`);
      if (res.status === 200) {
        const body = await res.json();
        const currentUrl = body?.loadBalancer?.servers?.[0]?.url;
        lastSeen = currentUrl;
        if (currentUrl === expectedBackendUrl) return;
      }
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Traefik never loaded the expected production backend ${expectedBackendUrl}: ` +
      `${lastError?.message ?? `last seen ${lastSeen}`}`,
  );
}

export async function promote({
  imageTag,
  repo,
  port = 3000,
  traefikContainerName,
  traefikApiUrl,
  previousContainerName,
}) {
  const containerName = `tugboat-production-${sanitizeForDockerTag(repo)}-${Date.now()}`;
  const { hostPort } = startProductionContainer({ imageTag, port, containerName });

  // Confirmed healthy directly (bypassing Traefik) before it's ever made
  // reachable through the production route at all.
  await waitForContainerHealthy({ hostPort });

  // Atomically repoint the production route at the new container. Unlike
  // Docker-label-driven discovery (used for preview branches), the file
  // provider gives us a single, explicit backend with no ambiguous window
  // where both old and new containers are simultaneously in rotation —
  // Traefik empirically routes to a Docker-label-discovered backend before
  // its first health check completes, which drops requests during a swap.
  writeProductionRoute({ traefikContainerName, containerName, port });

  // Traefik's file provider reload isn't instant; confirm via its own API
  // that it has actually loaded *this* backend before removing the only
  // other one, rather than guessing at a fixed delay.
  await waitForTraefikToLoadRoute({
    traefikApiUrl,
    expectedBackendUrl: `http://${containerName}:${port}`,
  });

  recordDeployment({ repo, imageTag, containerName });

  if (previousContainerName) {
    try {
      execFileSync("docker", ["stop", previousContainerName]);
    } catch {
      // best-effort: old container may already be gone
    }
    try {
      execFileSync("docker", ["rm", "-f", previousContainerName]);
    } catch {
      // best-effort
    }
  }

  return { containerName, hostPort };
}
