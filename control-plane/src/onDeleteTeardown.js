import { stopAppContainer } from "./runAppContainer.js";
import { stopTunnel } from "./tunnelManager.js";
import { getPreview, removePreview } from "./previewRegistry.js";
import { setDeploymentStatus } from "./db.js";

// `db` is optional so this stays usable exactly as before (real infra
// teardown only, no DB) for callers/tests that don't pass one.
export function createDeleteTeardownHandler(db) {
  return (parsedDelete) => {
    if (parsedDelete.refType !== "branch") return;

    const preview = getPreview({ repo: parsedDelete.repo, branch: parsedDelete.branch });
    if (!preview) return;

    stopAppContainer(preview.containerName);
    if (preview.tunnel) stopTunnel(preview.tunnel);

    removePreview({ repo: parsedDelete.repo, branch: parsedDelete.branch });

    // Reflect the real teardown in the dashboard — otherwise a deleted
    // branch's deployment sits forever showing a stale "success" status
    // and a dead preview link.
    if (db && preview.deploymentId) {
      setDeploymentStatus(db, preview.deploymentId, "torn_down");
    }
  };
}
