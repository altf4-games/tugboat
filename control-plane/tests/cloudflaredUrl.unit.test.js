import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractTrycloudflareUrl } from "../src/cloudflaredUrl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const capturedLog = fs.readFileSync(
  path.join(__dirname, "fixtures/cloudflared-output.captured.log"),
  "utf8",
);

describe("extractTrycloudflareUrl against real captured cloudflared output", () => {
  it("extracts the assigned trycloudflare.com URL from the full log", () => {
    expect(extractTrycloudflareUrl(capturedLog)).toBe(
      "https://husband-bali-mothers-encoding.trycloudflare.com",
    );
  });

  it("extracts the URL even when only a partial chunk (as streamed) is given", () => {
    const partialChunk =
      "|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |\n" +
      "2026-09-14T07:54:23Z INF |  https://husband-bali-mothers-encoding.trycloudflare.com                                   |\n";
    expect(extractTrycloudflareUrl(partialChunk)).toBe(
      "https://husband-bali-mothers-encoding.trycloudflare.com",
    );
  });

  it("returns null when no URL is present yet", () => {
    expect(extractTrycloudflareUrl("Requesting new quick Tunnel on trycloudflare.com...\n")).toBeNull();
  });
});
