import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { imageTagFor, packBuildArgs } from "./buildImage.js";
import { createDeployment, appendDeploymentLog, setDeploymentStatus } from "./db.js";

export function buildWithLogging(db, { repo, branch, sha, appPath, builder }) {
  const id = createDeployment(db, { repo, branch, sha });
  const imageTag = imageTagFor({ repo, sha });
  const emitter = new EventEmitter();

  const child = spawn("pack", packBuildArgs({ imageTag, appPath, builder }));

  const onChunk = (chunk) => {
    const text = chunk.toString();
    appendDeploymentLog(db, id, text);
    emitter.emit("log", text);
  };

  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);

  const done = new Promise((resolve, reject) => {
    child.on("error", (err) => {
      setDeploymentStatus(db, id, "failed");
      emitter.emit("done", { status: "failed" });
      reject(err);
    });

    child.on("exit", (code) => {
      if (code === 0) {
        setDeploymentStatus(db, id, "success", { imageTag });
        emitter.emit("done", { status: "success", imageTag });
        resolve({ id, imageTag });
      } else {
        setDeploymentStatus(db, id, "failed");
        emitter.emit("done", { status: "failed" });
        reject(new Error(`pack build exited with code ${code}`));
      }
    });
  });

  return { id, imageTag, emitter, done };
}
