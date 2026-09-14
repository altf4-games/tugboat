import { stopAppContainer } from "./runAppContainer.js";
import { stopTunnel } from "./tunnelManager.js";
import { getPreview, removePreview } from "./previewRegistry.js";

export function createDeleteTeardownHandler() {
  return (parsedDelete) => {
    if (parsedDelete.refType !== "branch") return;

    const preview = getPreview({ repo: parsedDelete.repo, branch: parsedDelete.branch });
    if (!preview) return;

    stopAppContainer(preview.containerName);
    if (preview.tunnel) stopTunnel(preview.tunnel);

    removePreview({ repo: parsedDelete.repo, branch: parsedDelete.branch });
  };
}
