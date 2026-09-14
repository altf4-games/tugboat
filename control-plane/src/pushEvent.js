export function parsePushEvent(payload) {
  const branch = payload.ref?.startsWith("refs/heads/")
    ? payload.ref.slice("refs/heads/".length)
    : payload.ref;

  return {
    repo: payload.repository?.full_name,
    branch,
    sha: payload.after,
  };
}
