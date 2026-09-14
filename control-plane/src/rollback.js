import { promote } from "./promote.js";
import { getDeploymentHistory } from "./deploymentHistory.js";

export async function rollback({ repo, port = 3000, traefikContainerName, traefikApiUrl }) {
  const history = getDeploymentHistory({ repo });

  if (history.length < 2) {
    throw new Error(`No previous deployment to roll back to for ${repo}`);
  }

  const current = history[history.length - 1];
  const previous = history[history.length - 2];

  // Rolling back is just re-promoting the previous image — this naturally
  // records a new history entry too, the same way a real rollback is a new
  // deployment event (of an old artifact), not a silent rewind.
  return promote({
    imageTag: previous.imageTag,
    repo,
    port,
    traefikContainerName,
    traefikApiUrl,
    previousContainerName: current.containerName,
  });
}
