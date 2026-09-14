import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function buildAuthenticatedCloneUrl({ cloneUrl, accessToken }) {
  const url = new URL(cloneUrl);
  url.username = "x-access-token";
  url.password = accessToken;
  return url.toString();
}

export function cloneRepoAtSha({ cloneUrl, accessToken, branch, sha }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tugboat-clone-"));
  const authenticatedUrl = buildAuthenticatedCloneUrl({ cloneUrl, accessToken });

  execFileSync("git", ["clone", "--branch", branch, "--single-branch", authenticatedUrl, dir], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  execFileSync("git", ["checkout", sha], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });

  return dir;
}

export function cleanupClone(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
