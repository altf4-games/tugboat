import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePushEvent } from "../src/pushEvent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const capturedPayload = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures/github-push-event.captured.json"),
    "utf8",
  ),
);

describe("parsePushEvent against a real captured GitHub push webhook payload", () => {
  it("extracts repo, branch, and commit SHA", () => {
    expect(parsePushEvent(capturedPayload)).toEqual({
      repo: "altf4-games/tugboat",
      branch: "webhook-test/1789369517994",
      sha: "b62c70851d1a36ae903ef5817e95ef3507b62cba",
    });
  });
});
