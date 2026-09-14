const historyByRepo = new Map();

export function recordDeployment({ repo, imageTag, containerName }) {
  const history = historyByRepo.get(repo) ?? [];
  history.push({ imageTag, containerName, promotedAt: Date.now() });
  historyByRepo.set(repo, history);
}

export function getDeploymentHistory({ repo }) {
  return historyByRepo.get(repo) ?? [];
}

export function getPreviousImageTag({ repo }) {
  const history = getDeploymentHistory({ repo });
  if (history.length < 2) return null;
  return history[history.length - 2].imageTag;
}
