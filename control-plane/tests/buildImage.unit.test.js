import { describe, it, expect } from "vitest";
import { sanitizeForDockerTag, imageTagFor, packBuildArgs } from "../src/buildImage.js";

describe("sanitizeForDockerTag", () => {
  it("lowercases and replaces disallowed characters with hyphens", () => {
    expect(sanitizeForDockerTag("altf4-games/tugboat")).toBe("altf4-games-tugboat");
    expect(sanitizeForDockerTag("Some/Repo_Name")).toBe("some-repo_name");
  });
});

describe("imageTagFor", () => {
  it("builds a tugboat-namespaced tag from repo and commit sha", () => {
    expect(imageTagFor({ repo: "altf4-games/tugboat", sha: "abc123" })).toBe(
      "tugboat/altf4-games-tugboat:abc123",
    );
  });
});

describe("packBuildArgs", () => {
  it("constructs the pack build command arguments", () => {
    expect(
      packBuildArgs({
        imageTag: "tugboat/altf4-games-tugboat:abc123",
        appPath: "/repo/sample-app",
        builder: "paketobuildpacks/builder-jammy-base",
      }),
    ).toEqual([
      "build",
      "tugboat/altf4-games-tugboat:abc123",
      "--path",
      "/repo/sample-app",
      "--builder",
      "paketobuildpacks/builder-jammy-base",
      "--trust-builder",
    ]);
  });

  it("defaults to the Paketo jammy-base builder when none is given", () => {
    const args = packBuildArgs({ imageTag: "t:1", appPath: "/repo" });
    expect(args).toContain("paketobuildpacks/builder-jammy-base");
  });
});
