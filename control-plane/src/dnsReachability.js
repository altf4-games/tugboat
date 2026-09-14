import dns from "node:dns";

// This machine's local/router DNS resolver has been observed to return
// NXDOMAIN for freshly-created *.trycloudflare.com subdomains for 20-30+
// seconds after cloudflared registers them, even though Cloudflare's own
// resolver already sees them immediately. Resolve explicitly via a public
// resolver instead of trusting the system default, so a deployment doesn't
// hand out (or try to screenshot) a link before it's actually reachable.
const publicResolver = new dns.Resolver();
publicResolver.setServers(["1.1.1.1"]);

export function resolveViaPublicDns(hostname) {
  return new Promise((resolve, reject) => {
    publicResolver.resolve4(hostname, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

export async function waitForDnsReady(hostname, { timeoutMs = 30_000, intervalMs = 1_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await resolveViaPublicDns(hostname);
      return;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${hostname} did not become resolvable within ${timeoutMs}ms: ${lastError?.message}`);
}
