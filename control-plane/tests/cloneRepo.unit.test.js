import { describe, it, expect } from "vitest";
import { buildAuthenticatedCloneUrl } from "../src/cloneRepo.js";

describe("buildAuthenticatedCloneUrl", () => {
  it("embeds the access token as HTTP basic auth in the clone URL", () => {
    const url = buildAuthenticatedCloneUrl({
      cloneUrl: "https://github.com/org/app.git",
      accessToken: "gho_secrettoken",
    });

    expect(url).toBe("https://x-access-token:gho_secrettoken@github.com/org/app.git");
  });
});
