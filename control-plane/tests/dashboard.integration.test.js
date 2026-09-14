import { describe, it, expect } from "vitest";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, listDeployments, getDeployment } from "../src/db.js";
import { buildWithLogging } from "../src/buildWithLogging.js";
import { createDashboardServer } from "../src/dashboardServer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleAppDir = path.resolve(__dirname, "../../sample-app");

describe("Phase 7 integration: dashboard streams real pack build output live", () => {
  it(
    "streams real build log chunks over time (not a single blob after completion), then reflects the finished deployment via the API",
    async () => {
      const db = openDb(":memory:");
      const liveBuilds = new Map();

      const build = buildWithLogging(db, {
        repo: "tugboat-phase7-test",
        branch: "main",
        sha: `dashboard-smoke-${Date.now()}`,
        appPath: sampleAppDir,
      });
      liveBuilds.set(build.id, build.emitter);

      const app = createDashboardServer({ db, liveBuilds });
      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      // Connect to the live stream while the build is still running.
      const received = [];
      const streamDone = new Promise((resolve, reject) => {
        http
          .get(`http://localhost:${port}/api/deployments/${build.id}/stream`, (res) => {
            let buffer = "";
            res.on("data", (chunk) => {
              buffer += chunk.toString();
              let boundary;
              while ((boundary = buffer.indexOf("\n\n")) !== -1) {
                const rawEvent = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data: "));
                if (!dataLine) continue;
                const payload = JSON.parse(dataLine.slice("data: ".length));
                received.push({ payload, at: Date.now() });
                if (payload.done) {
                  res.destroy();
                  resolve();
                }
              }
            });
            res.on("error", reject);
          })
          .on("error", reject);
      });

      await build.done;
      await streamDone;
      await new Promise((resolve) => server.close(resolve));

      const chunkEvents = received.filter((e) => e.payload.chunk);
      expect(chunkEvents.length).toBeGreaterThan(1);

      // Real streaming, not a completion-time dump: at least two chunks
      // must have arrived at meaningfully different times.
      const timestamps = new Set(chunkEvents.map((e) => e.at));
      expect(timestamps.size).toBeGreaterThan(1);

      const fullLog = chunkEvents.map((e) => e.payload.chunk).join("");
      expect(fullLog).toContain("===> DETECTING");
      expect(fullLog).toContain("Successfully built image");

      const doneEvent = received.find((e) => e.payload.done);
      expect(doneEvent.payload.status).toBe("success");

      const deployment = getDeployment(db, build.id);
      expect(deployment.status).toBe("success");
      expect(deployment.image_tag).toBe(build.imageTag);
      expect(deployment.log).toContain("Successfully built image");

      const listed = listDeployments(db);
      expect(listed.some((d) => d.id === build.id)).toBe(true);
    },
    120_000,
  );
});
