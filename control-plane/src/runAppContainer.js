import { execFileSync } from "node:child_process";
import { traefikLabelsFor } from "./dockerLabels.js";
import { NETWORK_NAME } from "./traefikController.js";

export function runAppContainer({ imageTag, repo, branch, port = 3000, containerName }) {
  const labels = traefikLabelsFor({ repo, branch, port });
  const labelArgs = Object.entries(labels).flatMap(([key, value]) => [
    "--label",
    `${key}=${value}`,
  ]);

  execFileSync("docker", [
    "run",
    "-d",
    "--network",
    NETWORK_NAME,
    "--name",
    containerName,
    ...labelArgs,
    imageTag,
  ]);

  return { containerName };
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
