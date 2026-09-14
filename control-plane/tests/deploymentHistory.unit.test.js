import { describe, it, expect, beforeEach } from "vitest";
import {
  recordDeployment,
  getDeploymentHistory,
  getPreviousImageTag,
} from "../src/deploymentHistory.js";

describe("deploymentHistory", () => {
  const repo = "test-repo/" + Math.random();

  it("returns an empty history for a repo with no deployments", () => {
    expect(getDeploymentHistory({ repo })).toEqual([]);
    expect(getPreviousImageTag({ repo })).toBeNull();
  });

  it("records deployments in order and exposes them as history", () => {
    recordDeployment({ repo, imageTag: "app:sha1", containerName: "c1" });
    recordDeployment({ repo, imageTag: "app:sha2", containerName: "c2" });

    const history = getDeploymentHistory({ repo });
    expect(history).toHaveLength(2);
    expect(history[0].imageTag).toBe("app:sha1");
    expect(history[1].imageTag).toBe("app:sha2");
  });

  it("returns the image tag one before the current (most recent) deployment", () => {
    expect(getPreviousImageTag({ repo })).toBe("app:sha1");
  });

  it("keeps histories for different repos independent", () => {
    const otherRepo = "other-repo/" + Math.random();
    expect(getDeploymentHistory({ repo: otherRepo })).toEqual([]);
  });
});
