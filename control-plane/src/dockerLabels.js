import { sanitizeForDockerTag, sanitizeForHostname } from "./sanitize.js";

export function routerNameFor({ repo, branch }) {
  return sanitizeForDockerTag(`${repo}-${branch}`);
}

export function hostnameFor({ branch }) {
  return `${sanitizeForHostname(branch)}.127.0.0.1.nip.io`;
}

export function traefikLabelsFor({ repo, branch, port }) {
  const router = routerNameFor({ repo, branch });
  const host = hostnameFor({ branch });

  return {
    "traefik.enable": "true",
    [`traefik.http.routers.${router}.rule`]: `Host(\`${host}\`)`,
    [`traefik.http.services.${router}.loadbalancer.server.port`]: String(port),
  };
}
