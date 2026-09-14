const TRYCLOUDFLARE_URL_PATTERN = /https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/;

export function extractTrycloudflareUrl(logChunk) {
  const match = logChunk.match(TRYCLOUDFLARE_URL_PATTERN);
  return match ? match[0] : null;
}
