import { spawn } from "node:child_process";
import { sanitizeForDockerTag } from "./sanitize.js";

const DEFAULT_BUILDER = "paketobuildpacks/builder-jammy-base";

export { sanitizeForDockerTag };

export function imageTagFor({ repo, sha }) {
  return `tugboat/${sanitizeForDockerTag(repo)}:${sha}`;
}

export function packBuildArgs({ imageTag, appPath, builder = DEFAULT_BUILDER }) {
  return ["build", imageTag, "--path", appPath, "--builder", builder, "--trust-builder"];
}

export function buildImage({ repo, sha, appPath, builder }) {
  const imageTag = imageTagFor({ repo, sha });

  return new Promise((resolve, reject) => {
    const child = spawn("pack", packBuildArgs({ imageTag, appPath, builder }), {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ imageTag });
      } else {
        reject(new Error(`pack build exited with code ${code}`));
      }
    });
  });
}
