import { buildImage } from "./buildImage.js";

export function createBuildOnPushHandler({ appPath, builder, onBuildComplete, onBuildError }) {
  return async (parsedPush) => {
    try {
      const result = await buildImage({
        repo: parsedPush.repo,
        sha: parsedPush.sha,
        appPath,
        builder,
      });
      onBuildComplete?.(result, parsedPush);
    } catch (err) {
      onBuildError?.(err, parsedPush);
    }
  };
}
