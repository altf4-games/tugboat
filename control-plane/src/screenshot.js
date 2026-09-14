import puppeteer from "puppeteer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SCREENSHOTS_DIR = path.resolve(__dirname, "../data/screenshots");

export function screenshotPathFor(deploymentId) {
  return path.join(SCREENSHOTS_DIR, `${deploymentId}.png`);
}

// Best-effort: a real screenshot of the real deployed URL, taken with a
// real headless browser. Never throws — a deployment's success doesn't
// depend on whether a thumbnail could be captured.
export async function captureScreenshot(url, deploymentId) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const outPath = screenshotPathFor(deploymentId);
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
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
