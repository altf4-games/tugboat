import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloneRepoAtSha, cleanupClone } from "../src/cloneRepo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot }).toString().trim();
}

function githubToken() {
  return execFileSync("gh", ["auth", "token"]).toString().trim();
}

function repoCloneUrl() {
  const remoteUrl = git(["remote", "get-url", "origin"]);
  const match = remoteUrl.match(/github\.com[:/](.+?)(\.git)?$/);
  if (!match) throw new Error(`Could not parse GitHub repo from remote: ${remoteUrl}`);
  return `https://github.com/${match[1]}.git`;
}

describe("Phase 10 integration: cloning a real (private) linked repo at a specific commit", () => {
  it("clones the real repo, authenticated with a real access token, and checks out the exact sha", () => {
    const cloneUrl = repoCloneUrl();
    const accessToken = githubToken();
    const branch = "main";
    const sha = git(["rev-parse", "main"]);

    const dir = cloneRepoAtSha({ cloneUrl, accessToken, branch, sha });

    try {
      expect(fs.existsSync(path.join(dir, "sample-app", "server.js"))).toBe(true);

      const clonedSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
      expect(clonedSha).toBe(sha);
    } finally {
      cleanupClone(dir);
      expect(fs.existsSync(dir)).toBe(false);
    }
  }, 30_000);
});
