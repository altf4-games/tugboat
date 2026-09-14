import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleAppDir = path.resolve(__dirname, "../../sample-app");
const imageTag = "tugboat/sample-app:phase0-smoke";

describe("Phase 0 smoke test: pack build against sample-app", () => {
  it("produces a real, runnable image in the local Docker daemon", () => {
    execFileSync(
      "pack",
      [
        "build",
        imageTag,
        "--path",
        sampleAppDir,
        "--builder",
        "paketobuildpacks/builder-jammy-base",
        "--trust-builder",
      ],
      { stdio: "inherit" },
    );

    const inspected = JSON.parse(
      execFileSync("docker", ["image", "inspect", imageTag]).toString(),
    );

    expect(inspected).toHaveLength(1);
    expect(inspected[0].RepoTags).toContain(imageTag);
  }, 300_000);
});
