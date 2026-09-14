const registry = new Map();

function key(repo, branch) {
  return `${repo}#${branch}`;
}

export function registerPreview({ repo, branch, containerName, tunnel }) {
  registry.set(key(repo, branch), { containerName, tunnel });
}

export function getPreview({ repo, branch }) {
  return registry.get(key(repo, branch));
}

export function removePreview({ repo, branch }) {
  registry.delete(key(repo, branch));
}
