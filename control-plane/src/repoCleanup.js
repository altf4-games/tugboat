import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { sanitizeForDockerTag } from "./sanitize.js";
import { stopAppContainer } from "./runAppContainer.js";
import { stopTunnel } from "./tunnelManager.js";
import { takeAllPreviewsForRepo } from "./previewRegistry.js";
import { clearProductionRoute } from "./productionRoute.js";
import { clearDeploymentHistory } from "./deploymentHistory.js";
import { listDeployments, deleteDeploymentsByRepo, deleteWebhookDeliveriesByRepo } from "./db.js";
import { screenshotPathFor } from "./screenshot.js";

function dockerNamesMatching(kind, prefix) {
  try {
    return execFileSync("docker", [kind, "-a", "--filter", `name=${prefix}`, "--format", "{{.Names}}"])
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((name) => name.startsWith(prefix));
  } catch {
    return [];
  }
}

function dockerImageTagsMatching(repository) {
  try {
    return execFileSync("docker", [
      "images",
      "--filter",
      `reference=${repository}`,
      "--format",
      "{{.Repository}}:{{.Tag}}",
    ])
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function dockerVolumeNamesMatching(substr) {
  try {
    return execFileSync("docker", ["volume", "ls", "-q", "--filter", `name=${substr}`])
      .toString()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Unlinking a project should leave nothing real behind — no running
// preview/production containers, no dangling Traefik production route, no
// built images, no pack build cache — otherwise disk usage only ever grows
// across every repo someone links and unlinks.
export function cleanupRepo({ db, repo, traefikContainerName, liveBuilds }) {
  // The live-tunnel half of a preview (the cloudflared subprocess) is only
  // known to the currently-running server's in-memory registry — if this
  // runs against a stopped server (or the registry was never populated,
  // e.g. after a restart), that's empty and nothing here gets torn down.
  for (const preview of takeAllPreviewsForRepo(repo)) {
    stopAppContainer(preview.containerName);
    if (preview.tunnel) stopTunnel(preview.tunnel);
  }

  const sanitized = sanitizeForDockerTag(repo);
  const deployments = listDeployments(db, { repo });

  // Container names are deterministic from the deployment id
  // (tugboat-preview-<id>), so sweep by name too — this is what actually
  // catches a leftover preview container when the registry above was
  // empty, since the container itself doesn't disappear just because the
  // process that registered it did.
  for (const deployment of deployments) {
    stopAppContainer(`tugboat-preview-${deployment.id}`);
  }

  const productionContainers = dockerNamesMatching("ps", `tugboat-production-${sanitized}-`);
  for (const name of productionContainers) {
    try {
      execFileSync("docker", ["rm", "-f", name]);
    } catch {
      // best-effort
    }
  }
  // This repo held the single global production slot — clear the route
  // rather than leave Traefik pointed at a container that no longer exists.
  if (productionContainers.length > 0 && traefikContainerName) {
    clearProductionRoute({ traefikContainerName });
  }

  clearDeploymentHistory({ repo });

  for (const deployment of deployments) {
    fs.rmSync(screenshotPathFor(deployment.id), { force: true });
    liveBuilds?.delete(deployment.id);
  }
  deleteDeploymentsByRepo(db, repo);
  deleteWebhookDeliveriesByRepo(db, repo);

  for (const imageTag of dockerImageTagsMatching(`tugboat/${sanitized}`)) {
    try {
      execFileSync("docker", ["rmi", "-f", imageTag]);
    } catch {
      // best-effort
    }
  }

  for (const volume of dockerVolumeNamesMatching(`pack-cache-tugboat_${sanitized}_`)) {
    try {
      execFileSync("docker", ["volume", "rm", "-f", volume]);
    } catch {
      // best-effort
    }
  }
}
