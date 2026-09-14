// Prevents two deploys for the same repo+branch from running concurrently.
// Without this, two overlapping pipeline runs (e.g. clicking "Redeploy"
// twice, or a webhook arriving while a manual deploy is still in flight)
// race on previewRegistry's single "current preview" slot per branch: the
// second run's "tear down the existing preview" step can kill the first
// run's container/tunnel while it's still the one being shown/visited.
const inFlight = new Set();

function key(repo, branch) {
  return `${repo}#${branch}`;
}

export function isDeployInFlight({ repo, branch }) {
  return inFlight.has(key(repo, branch));
}

// Synchronous compare-and-set: returns true and locks it if free, false if
// already locked. Safe against races because Node is single-threaded and
// this never awaits.
export function tryAcquireDeployLock({ repo, branch }) {
  const k = key(repo, branch);
  if (inFlight.has(k)) return false;
  inFlight.add(k);
  return true;
}

export function releaseDeployLock({ repo, branch }) {
  inFlight.delete(key(repo, branch));
}
