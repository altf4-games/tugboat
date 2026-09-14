import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCKER_API_PROXY_CONF = path.resolve(__dirname, "../docker/docker-api-proxy.conf");

export const NETWORK_NAME = "tugboat";

function proxyContainerName(traefikContainerName) {
  return `${traefikContainerName}-docker-proxy`;
}

function resolveDockerSocketPath() {
  const contextName = execFileSync("docker", ["context", "show"]).toString().trim();
  const host = execFileSync("docker", [
    "context",
    "inspect",
    contextName,
    "--format",
    "{{.Endpoints.docker.Host}}",
  ])
    .toString()
    .trim();

  return host.startsWith("unix://") ? host.slice("unix://".length) : "/var/run/docker.sock";
}

export function ensureNetwork() {
  try {
    execFileSync("docker", ["network", "inspect", NETWORK_NAME], { stdio: "ignore" });
  } catch {
    execFileSync("docker", ["network", "create", NETWORK_NAME]);
  }
}

export function startTraefik({ containerName, httpPort }) {
  ensureNetwork();
  const dockerSocket = resolveDockerSocketPath();
  const proxyName = proxyContainerName(containerName);

  // Traefik's bundled Docker client hardcodes API version 1.24 and never
  // negotiates upward; OrbStack's daemon rejects that outright (min 1.40).
  // Route Traefik's Docker provider through a small path-rewriting proxy
  // instead of the raw socket. See docker/docker-api-proxy.conf.
  execFileSync("docker", [
    "run",
    "-d",
    "--name",
    proxyName,
    "--network",
    NETWORK_NAME,
    "-v",
    `${dockerSocket}:/var/run/docker.sock:ro`,
    "-v",
    `${DOCKER_API_PROXY_CONF}:/etc/nginx/nginx.conf:ro`,
    "nginx:alpine",
  ]);

  execFileSync("docker", [
    "run",
    "-d",
    "--name",
    containerName,
    "--network",
    NETWORK_NAME,
    "-p",
    `${httpPort}:80`,
    "traefik:v3.1",
    "--providers.docker=true",
    "--providers.docker.exposedbydefault=false",
    `--providers.docker.network=${NETWORK_NAME}`,
    `--providers.docker.endpoint=tcp://${proxyName}:2375`,
    "--entrypoints.web.address=:80",
  ]);

  return { containerName, network: NETWORK_NAME };
}

export function stopTraefik(containerName) {
  for (const name of [containerName, proxyContainerName(containerName)]) {
    try {
      execFileSync("docker", ["stop", name]);
    } catch {
      // best-effort cleanup
    }
    try {
      execFileSync("docker", ["rm", "-f", name]);
    } catch {
      // best-effort cleanup
    }
  }
}
