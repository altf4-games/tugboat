import https from "node:https";
import { resolveViaPublicDns } from "./dnsReachability.js";

// cloudflared prints the quick-tunnel URL as soon as it registers, and the
// name starts resolving in DNS a few seconds before the tunnel actually
// carries traffic. In that gap Cloudflare answers every request with its
// "Error 1033" page (HTTP 530). Make a real request through the public URL
// and wait until that stops, so the link handed out, and the screenshot taken
// of it, show the app instead of the error page.
function requestOnce(url, ip) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: url.hostname,
        path: "/",
        method: "GET",
        timeout: 10_000,
        // Connect to the address the public resolver returned, but keep the
        // real hostname so SNI and the Host header still route correctly.
        lookup: (_host, options, callback) =>
          options.all ? callback(null, [{ address: ip, family: 4 }]) : callback(null, ip, 4),
      },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timed out")));
    req.on("error", reject);
    req.end();
  });
}

export async function waitForTunnelReady(urlString, { timeoutMs = 60_000, intervalMs = 1_000 } = {}) {
  const url = new URL(urlString);
  const deadline = Date.now() + timeoutMs;
  let last = "no response yet";
  while (Date.now() < deadline) {
    try {
      const [ip] = await resolveViaPublicDns(url.hostname);
      const status = await requestOnce(url, ip);
      if (status !== 530) return;
      last = `Cloudflare tunnel error (HTTP ${status})`;
    } catch (err) {
      last = err.message;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${url.hostname} did not become reachable within ${timeoutMs}ms: ${last}`);
}
