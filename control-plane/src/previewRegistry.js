const registry = new Map();

function key(repo, branch) {
  return `${repo}#${branch}`;
}

export function registerPreview({ repo, branch, containerName, tunnel, deploymentId }) {
  registry.set(key(repo, branch), { containerName, tunnel, deploymentId });
}

export function getPreview({ repo, branch }) {
  return registry.get(key(repo, branch));
}

export function removePreview({ repo, branch }) {
  registry.delete(key(repo, branch));
}

// Removes and returns every live preview registered for a repo, across all
// its branches — used when unlinking a project, so every real container and
// tunnel it still owns gets torn down, not just the last-touched branch.
export function takeAllPreviewsForRepo(repo) {
  const prefix = `${repo}#`;
  const taken = [];
  for (const [k, value] of registry.entries()) {
    if (k.startsWith(prefix)) {
      taken.push(value);
      registry.delete(k);
    }
  }
  return taken;
}
