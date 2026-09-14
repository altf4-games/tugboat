import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { hostnameFor } from "./dockerLabels.js";
import { DYNAMIC_CONFIG_DIR } from "./traefikController.js";

const ROUTE_NAME = "production";

export function buildProductionRouteConfig({ containerName, port }) {
  const hostname = hostnameFor({ branch: ROUTE_NAME });

  return `http:
  routers:
    ${ROUTE_NAME}:
      rule: "Host(\`${hostname}\`)"
      service: ${ROUTE_NAME}
      entryPoints:
        - web
  services:
    ${ROUTE_NAME}:
      loadBalancer:
        servers:
          - url: "http://${containerName}:${port}"
`;
}

// Removes the production route file entirely, so Traefik stops routing
// production.* anywhere — used when the repo that currently holds the
// single production slot gets unlinked and its container is torn down.
export function clearProductionRoute({ traefikContainerName }) {
  try {
    execFileSync("docker", [
      "exec",
      traefikContainerName,
      "rm",
      "-f",
      `${DYNAMIC_CONFIG_DIR}/production.yml`,
    ]);
  } catch {
    // best-effort — Traefik container may already be stopped
  }
}

export function writeProductionRoute({ traefikContainerName, containerName, port }) {
  const config = buildProductionRouteConfig({ containerName, port });
  const tmpFile = path.join(os.tmpdir(), `tugboat-production-route-${Date.now()}.yml`);
  fs.writeFileSync(tmpFile, config);

  try {
    // See traefikController.js for why this is `docker cp` and not a bind
    // mount: the target directory already exists inside the container.
    execFileSync("docker", [
      "cp",
      tmpFile,
      `${traefikContainerName}:${DYNAMIC_CONFIG_DIR}/production.yml`,
    ]);
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}
