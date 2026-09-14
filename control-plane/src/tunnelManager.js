import { spawn } from "node:child_process";
import { extractTrycloudflareUrl } from "./cloudflaredUrl.js";

export function startTunnel({ localPort, timeoutMs = 30_000 }) {
  const child = spawn(
    "cloudflared",
    ["tunnel", "--url", `http://localhost:${localPort}`, "--no-autoupdate"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const url = new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for trycloudflare.com URL. Output so far:\n${buffer}`));
    }, timeoutMs);

    const onData = (chunk) => {
      buffer += chunk.toString();
      const foundUrl = extractTrycloudflareUrl(buffer);
      if (foundUrl) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        resolve(foundUrl);
      }
    };

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  return { process: child, url };
}

export function stopTunnel(tunnel) {
  tunnel.process.kill();
}
