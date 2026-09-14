import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDeleteEvent } from "../src/deleteEvent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const capturedPayload = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures/github-delete-event.captured.json"), "utf8"),
);

describe("parseDeleteEvent against a real captured GitHub branch-delete webhook payload", () => {
  it("extracts repo, branch, and ref type", () => {
    expect(parseDeleteEvent(capturedPayload)).toEqual({
      repo: "altf4-games/tugboat",
      branch: "teardown-test/1789377844488",
      refType: "branch",
    });
  });

  it("returns a null branch for a tag deletion", () => {
    expect(parseDeleteEvent({ ...capturedPayload, ref_type: "tag", ref: "v1.0.0" })).toEqual({
      repo: "altf4-games/tugboat",
      branch: null,
      refType: "tag",
    });
  });
});
