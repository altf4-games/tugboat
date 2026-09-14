import { describe, it, expect } from "vitest";
import { resolveAppPath } from "../src/projectPipeline.js";

describe("resolveAppPath", () => {
  it("builds at the repo root when no root directory is configured", () => {
    expect(resolveAppPath({ cloneDir: "/tmp/clone-abc", rootDirectory: "" })).toBe(
      "/tmp/clone-abc",
    );
  });

  it("builds from a subdirectory when a root directory is configured (monorepo support)", () => {
    expect(resolveAppPath({ cloneDir: "/tmp/clone-abc", rootDirectory: "sample-app" })).toBe(
      "/tmp/clone-abc/sample-app",
    );
  });
});
