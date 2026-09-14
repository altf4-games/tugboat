import { describe, it, expect } from "vitest";
import { isDeployInFlight, tryAcquireDeployLock, releaseDeployLock } from "../src/deployLock.js";

describe("deployLock", () => {
  it("is not in flight before anything acquires it", () => {
    expect(isDeployInFlight({ repo: "org/app", branch: "main" })).toBe(false);
  });

  it("allows the first acquire and reports in-flight afterward", () => {
    const repo = "org/app-" + Math.random();
    expect(tryAcquireDeployLock({ repo, branch: "main" })).toBe(true);
    expect(isDeployInFlight({ repo, branch: "main" })).toBe(true);
  });

  it("rejects a second acquire for the same repo+branch while the first is still held", () => {
    const repo = "org/app-" + Math.random();
    expect(tryAcquireDeployLock({ repo, branch: "main" })).toBe(true);
    expect(tryAcquireDeployLock({ repo, branch: "main" })).toBe(false);
  });

  it("allows re-acquiring after release", () => {
    const repo = "org/app-" + Math.random();
    tryAcquireDeployLock({ repo, branch: "main" });
    releaseDeployLock({ repo, branch: "main" });
    expect(isDeployInFlight({ repo, branch: "main" })).toBe(false);
    expect(tryAcquireDeployLock({ repo, branch: "main" })).toBe(true);
  });

  it("treats different branches of the same repo independently", () => {
    const repo = "org/app-" + Math.random();
    expect(tryAcquireDeployLock({ repo, branch: "main" })).toBe(true);
    expect(tryAcquireDeployLock({ repo, branch: "feature-x" })).toBe(true);
  });
});
