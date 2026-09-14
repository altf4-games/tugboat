import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { runAppContainer, stopAppContainer } from "../src/runAppContainer.js";
import { ensureNetwork } from "../src/traefikController.js";

async function waitUntilExited(containerName, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = JSON.parse(
      execFileSync("docker", ["inspect", "--format", "{{json .State}}", containerName]).toString(),
    );
    if (state.Status === "exited") return state;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`Container ${containerName} never exited within ${timeoutMs}ms`);
}

describe("Phase 9 integration: real per-app memory limit enforcement", () => {
  it(
    "a container exceeding its --memory limit is actually OOM-killed by Docker (observed via docker inspect)",
    async () => {
      ensureNetwork();
      const containerName = `tugboat-oom-test-${Date.now()}`;

      runAppContainer({
        imageTag: "node:20-alpine",
        repo: "tugboat-phase9-test",
        branch: "oom-smoke",
        port: 3000,
        containerName,
        memoryLimit: "20m",
        command: [
          "node",
          "-e",
          // Buffer.alloc's own zero-fill alone was empirically not enough
          // to reliably trip the cgroup limit here; explicitly touching
          // every page with a non-zero value forces real physical page
          // commits that genuinely exceed the 20m limit.
          "const b = Buffer.alloc(300 * 1024 * 1024, 1); let s = 0; " +
            "for (let i = 0; i < b.length; i += 4096) s += b[i]; " +
            "console.log('should not get here', s);",
        ],
      });

      try {
        const state = await waitUntilExited(containerName);

        expect(state.OOMKilled).toBe(true);
        expect(state.ExitCode).not.toBe(0);
      } finally {
        stopAppContainer(containerName);
      }
    },
    40_000,
  );

  it(
    "the same command comfortably fits, and is NOT OOM-killed, without a tight memory limit",
    async () => {
      ensureNetwork();
      const containerName = `tugboat-no-oom-test-${Date.now()}`;

      runAppContainer({
        imageTag: "node:20-alpine",
        repo: "tugboat-phase9-test",
        branch: "no-oom-smoke",
        port: 3000,
        containerName,
        memoryLimit: "512m",
        command: [
          "node",
          "-e",
          "const b = Buffer.alloc(50 * 1024 * 1024, 1); let s = 0; " +
            "for (let i = 0; i < b.length; i += 4096) s += b[i]; " +
            "console.log('allocated fine', s);",
        ],
      });

      try {
        const state = await waitUntilExited(containerName);

        expect(state.OOMKilled).toBe(false);
        expect(state.ExitCode).toBe(0);
      } finally {
        stopAppContainer(containerName);
      }
    },
    40_000,
  );
});
