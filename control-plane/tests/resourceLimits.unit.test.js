import { describe, it, expect } from "vitest";
import { dockerResourceArgs } from "../src/resourceLimits.js";

describe("dockerResourceArgs", () => {
  it("returns no args when no limits are given", () => {
    expect(dockerResourceArgs({})).toEqual([]);
  });

  it("adds a --memory flag when a memory limit is given", () => {
    expect(dockerResourceArgs({ memoryLimit: "50m" })).toEqual(["--memory", "50m"]);
  });

  it("adds a --cpus flag when a cpu limit is given", () => {
    expect(dockerResourceArgs({ cpuLimit: "0.5" })).toEqual(["--cpus", "0.5"]);
  });

  it("combines both when both limits are given", () => {
    expect(dockerResourceArgs({ memoryLimit: "50m", cpuLimit: "0.5" })).toEqual([
      "--memory",
      "50m",
      "--cpus",
      "0.5",
    ]);
  });
});
