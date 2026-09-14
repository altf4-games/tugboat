import { execFileSync } from "node:child_process";
import { traefikLabelsFor } from "./dockerLabels.js";
import { NETWORK_NAME } from "./traefikController.js";
import { dockerResourceArgs } from "./resourceLimits.js";

export function runAppContainer({
  imageTag,
  repo,
  branch,
  port = 3000,
  containerName,
  publishPort = false,
  memoryLimit,
  cpuLimit,
  command = [],
}) {
  const labels = traefikLabelsFor({ repo, branch, port });
  const labelArgs = Object.entries(labels).flatMap(([key, value]) => [
    "--label",
    `${key}=${value}`,
  ]);
  const publishArgs = publishPort ? ["-p", `0:${port}`] : [];
  const resourceArgs = dockerResourceArgs({ memoryLimit, cpuLimit });

  execFileSync("docker", [
    "run",
    "-d",
    "--network",
    NETWORK_NAME,
    "--name",
    containerName,
    ...publishArgs,
    ...resourceArgs,
    ...labelArgs,
    imageTag,
    ...command,
  ]);

  if (!publishPort) {
    return { containerName };
  }

  const hostPort = JSON.parse(execFileSync("docker", ["inspect", containerName]).toString())[0]
    .NetworkSettings.Ports[`${port}/tcp`][0].HostPort;

  return { containerName, hostPort };
}

export function stopAppContainer(containerName) {
  try {
    execFileSync("docker", ["stop", containerName]);
  } catch {
    // best-effort cleanup
  }
  try {
    execFileSync("docker", ["rm", "-f", containerName]);
  } catch {
    // best-effort cleanup
  }
}
