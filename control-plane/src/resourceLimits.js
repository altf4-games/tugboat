export function dockerResourceArgs({ memoryLimit, cpuLimit } = {}) {
  const args = [];
  if (memoryLimit) args.push("--memory", memoryLimit);
  if (cpuLimit) args.push("--cpus", cpuLimit);
  return args;
}
