import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveViaPublicDns } from "./dnsReachability.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCREENSHOTS_DIR = path.resolve(__dirname, "../data/screenshots");

export function screenshotPathFor(deploymentId) {
  return path.join(SCREENSHOTS_DIR, `${deploymentId}.png`);
}

// Best-effort: a real screenshot of the real deployed URL, taken with a
// real headless browser. Never throws — a deployment's success doesn't
// depend on whether a thumbnail could be captured.
//
// Chromium resolves DNS through this machine's local/router resolver, which
// has been observed to lag a fresh *.trycloudflare.com subdomain by far
// longer than the public resolver (see dnsReachability.js) — so even after
// projectPipeline.js confirms the hostname resolves publicly, Chromium's own
// lookup can still fail here. Rather than wait out that lag, resolve the
// real IP via the public resolver ourselves and hand Chromium a
// --host-resolver-rules override so it skips its own (lagging) lookup
// entirely and connects straight to the known-good address — the request
// still carries the real hostname as its Host header/SNI, so Cloudflare's
// edge routes it correctly.
export async function captureScreenshot(url, deploymentId) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const outPath = screenshotPathFor(deploymentId);
  const hostname = new URL(url).hostname;

  const launchArgs = ["--no-sandbox"];
  try {
    const [ip] = await resolveViaPublicDns(hostname);
    launchArgs.push(`--host-resolver-rules=MAP ${hostname} ${ip}`);
  } catch {
    // fall through and let Chromium try its own resolution
  }

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: launchArgs });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 20_000 });
    await page.screenshot({ path: outPath });
    return outPath;
  } catch (err) {
    console.warn(`[tugboat] screenshot capture failed for deployment ${deploymentId}: ${err.message}`);
    return null;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
