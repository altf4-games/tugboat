import { describe, it, expect } from "vitest";
import { buildAuthorizeUrl, fetchGithubRepos } from "../src/githubOAuth.js";

describe("buildAuthorizeUrl", () => {
  it("builds a real GitHub OAuth authorize URL with the required parameters", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "client123",
        redirectUri: "http://localhost:4000/auth/callback",
        state: "state-abc",
      }),
    );

    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("client123");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4000/auth/callback");
    expect(url.searchParams.get("scope")).toBe("repo");
    expect(url.searchParams.get("state")).toBe("state-abc");
  });
});

describe("fetchGithubRepos", () => {
  // A real request to the real GitHub API with a token GitHub rejects, so the
  // 401 here is GitHub's own answer rather than a made-up one.
  it("reports GitHub's HTTP status on the error when the token is rejected", async () => {
    const err = await fetchGithubRepos("not-a-real-token").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(401);
  });
});
