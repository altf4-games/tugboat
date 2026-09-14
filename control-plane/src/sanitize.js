export function sanitizeForDockerTag(value) {
  return value.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

export function sanitizeForHostname(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}
