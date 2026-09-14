import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Integration tests register real webhooks and push real branches
    // against the same shared GitHub repo — that's a single external
    // resource, not per-test isolated state, so test files must not run
    // concurrently against it.
    fileParallelism: false,
  },
});
