import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCKER_API_PROXY_CONF = path.resolve(__dirname, "../docker/docker-api-proxy.conf");

export const NETWORK_NAME = "tugboat";
export const DYNAMIC_CONFIG_DIR = "/etc/traefik/dynamic";

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

export function startTraefik({ containerName, httpPort, apiPort }) {
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

  // The production route (see productionRoute.js) is pushed into this
  // directory with `docker cp` rather than a host bind mount: Traefik's
  // file-provider watch relies on inotify, and inotify does not reliably
  // fire for host-side writes to a bind-mounted file across the macOS/VM
  // boundary. A `docker cp` write lands natively in the container's own
  // filesystem, where inotify works as expected.
  const apiPortArgs = apiPort ? ["-p", `${apiPort}:8080`] : [];
  const apiTraefikArgs = apiPort ? ["--api.insecure=true"] : [];

  execFileSync("docker", [
    "run",
    "-d",
    "--name",
    containerName,
    "--network",
    NETWORK_NAME,
    "-p",
    `${httpPort}:80`,
    ...apiPortArgs,
    "--entrypoint",
    "sh",
    "traefik:v3.1",
    "-c",
    [
      `mkdir -p ${DYNAMIC_CONFIG_DIR}`,
      [
        "exec traefik",
        "--providers.docker=true",
        "--providers.docker.exposedbydefault=false",
        `--providers.docker.network=${NETWORK_NAME}`,
        `--providers.docker.endpoint=tcp://${proxyName}:2375`,
        "--entrypoints.web.address=:80",
        `--providers.file.directory=${DYNAMIC_CONFIG_DIR}`,
        "--providers.file.watch=true",
        ...apiTraefikArgs,
      ].join(" "),
    ].join(" && "),
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
