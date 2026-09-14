import { describe, it, expect } from "vitest";
import { computeGithubSignature, verifyGithubSignature } from "../src/hmac.js";

describe("GitHub webhook HMAC signature verification", () => {
  const secret = "a-real-webhook-secret-1234567890";
  const rawBody = Buffer.from(JSON.stringify({ hello: "world" }));

  it("accepts a signature computed the same way GitHub computes it", () => {
    const signature = computeGithubSignature(secret, rawBody);
    expect(verifyGithubSignature(secret, rawBody, signature)).toBe(true);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const signature = computeGithubSignature("wrong-secret", rawBody);
    expect(verifyGithubSignature(secret, rawBody, signature)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const signature = computeGithubSignature(secret, rawBody);
    const tampered = Buffer.from(JSON.stringify({ hello: "world!" }));
    expect(verifyGithubSignature(secret, tampered, signature)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyGithubSignature(secret, rawBody, undefined)).toBe(false);
  });
});
