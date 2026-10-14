import { describe, it, expect, afterAll } from "vitest";
import http from "node:http";
import https from "node:https";
import { startTunnel, stopTunnel } from "../src/tunnelManager.js";
import { waitForTunnelReady } from "../src/tunnelReachability.js";
import { resolveViaPublicDns } from "../src/dnsReachability.js";

// A real local HTTP server behind a real cloudflared quick tunnel. The point
// under test: once waitForTunnelReady resolves, the very next request through
// the public URL reaches the real server. Without it, DNS can resolve a few
// seconds before the tunnel connects and Cloudflare answers with its 1033
// error page instead.
const server = http.createServer((req, res) => res.end("tunnel-reachability-ok"));
let tunnel;

afterAll(() => {
  if (tunnel) stopTunnel(tunnel);
  server.close();
});

async function getViaPublicDns(urlString) {
  const url = new URL(urlString);
  const [ip] = await resolveViaPublicDns(url.hostname);
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: url.hostname, path: "/", method: "GET", lookup: (h, o, cb) => (o.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)) },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("waitForTunnelReady", () => {
  it("resolves only once the real tunnel serves the real app", async () => {
    await new Promise((resolve) => server.listen(0, resolve));
    tunnel = startTunnel({ localPort: server.address().port });
    const url = await tunnel.url;

    await waitForTunnelReady(url, { timeoutMs: 90_000 });

    const res = await getViaPublicDns(url);
    expect(res.status).toBe(200);
    expect(res.body).toBe("tunnel-reachability-ok");
  }, 120_000);

  it("rejects when the hostname never becomes a working tunnel", async () => {
    await expect(
      waitForTunnelReady("https://no-such-tunnel-tugboat-test.trycloudflare.com", { timeoutMs: 3_000, intervalMs: 500 }),
    ).rejects.toThrow(/did not become reachable/);
  }, 20_000);
});
