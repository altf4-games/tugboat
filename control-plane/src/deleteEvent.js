export function parseDeleteEvent(payload) {
  return {
    repo: payload.repository?.full_name,
    branch: payload.ref_type === "branch" ? payload.ref : null,
    refType: payload.ref_type,
  };
}
