import { describe, it, expect } from "vitest";
import { createSession, getSession, destroySession } from "../src/session.js";

describe("session", () => {
  const secret = "test-secret";

  it("creates a session and reads it back with the correct cookie value", () => {
    const cookie = createSession({ login: "octocat" }, secret);
    expect(getSession(cookie, secret)).toEqual({ login: "octocat" });
  });

  it("rejects a tampered cookie value", () => {
    const cookie = createSession({ login: "octocat" }, secret);
    const [id] = cookie.split(".");
    const tampered = `${id}.0000000000000000000000000000000000000000000000000000000000000000`;
    expect(getSession(tampered, secret)).toBeNull();
  });

  it("rejects a cookie signed with the wrong secret", () => {
    const cookie = createSession({ login: "octocat" }, secret);
    expect(getSession(cookie, "wrong-secret")).toBeNull();
  });

  it("returns null for a missing cookie", () => {
    expect(getSession(undefined, secret)).toBeNull();
    expect(getSession("", secret)).toBeNull();
  });

  it("forgets a session once destroyed", () => {
    const cookie = createSession({ login: "octocat" }, secret);
    destroySession(cookie);
    expect(getSession(cookie, secret)).toBeNull();
  });
});
