import path from "node:path";
import { buildWithLogging } from "./buildWithLogging.js";
import { cloneRepoAtSha, cleanupClone } from "./cloneRepo.js";
import { runAppContainer, stopAppContainer } from "./runAppContainer.js";
import { startTunnel, stopTunnel } from "./tunnelManager.js";
import { promote } from "./promote.js";
import { registerPreview, getPreview } from "./previewRegistry.js";
import { getDeploymentHistory } from "./deploymentHistory.js";
import { setDeploymentUrl, markDeploymentProduction, appendDeploymentLog } from "./db.js";

const APP_PORT = 3000;

// Supports monorepos the same way Vercel/Railway do: a project can name a
// subdirectory of the repo as where its actual app lives, instead of
// assuming the buildable app is always at the repo root.
export function resolveAppPath({ cloneDir, rootDirectory }) {
  return rootDirectory ? path.join(cloneDir, rootDirectory) : cloneDir;
}

export function createProjectPushHandler({ db, liveBuilds, traefikContainerName, traefikApiUrl }) {
  return async (parsedPush, project) => {
    let cloneDir;
    let build;

    try {
      cloneDir = cloneRepoAtSha({
        cloneUrl: project.clone_url,
        accessToken: project.access_token,
        branch: parsedPush.branch,
        sha: parsedPush.sha,
      });

      const appPath = resolveAppPath({ cloneDir, rootDirectory: project.root_directory });

      build = buildWithLogging(db, {
        repo: parsedPush.repo,
        branch: parsedPush.branch,
        sha: parsedPush.sha,
        appPath,
      });
      liveBuilds.set(build.id, build.emitter);

      const result = await build.done;

      const existingPreview = getPreview({ repo: parsedPush.repo, branch: parsedPush.branch });
      if (existingPreview) {
        stopAppContainer(existingPreview.containerName);
        stopTunnel(existingPreview.tunnel);
      }

      const containerName = `tugboat-preview-${build.id}`;
      const { hostPort } = runAppContainer({
        imageTag: result.imageTag,
        repo: parsedPush.repo,
        branch: parsedPush.branch,
        port: APP_PORT,
        containerName,
        publishPort: true,
      });

      const tunnel = startTunnel({ localPort: Number(hostPort) });
      const tunnelUrl = await tunnel.url;

      setDeploymentUrl(db, build.id, tunnelUrl);
      registerPreview({ repo: parsedPush.repo, branch: parsedPush.branch, containerName, tunnel });

      if (parsedPush.branch === project.default_branch) {
        const history = getDeploymentHistory({ repo: parsedPush.repo });
        const previousProduction = history.length > 0 ? history[history.length - 1] : null;

        await promote({
          imageTag: result.imageTag,
          repo: parsedPush.repo,
          port: APP_PORT,
          traefikContainerName,
          traefikApiUrl,
          previousContainerName: previousProduction?.containerName,
        });
        markDeploymentProduction(db, build.id);
      }
    } catch (err) {
      if (build) {
        appendDeploymentLog(db, build.id, `\n[tugboat] pipeline error: ${err.message}\n`);
      } else {
        console.error("project pipeline error before build started", err);
      }
    } finally {
      if (cloneDir) cleanupClone(cloneDir);
    }
  };
}
