import crypto from "node:crypto";

export function computeGithubSignature(secret, rawBody) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function verifyGithubSignature(secret, rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  const expected = Buffer.from(computeGithubSignature(secret, rawBody));
  const actual = Buffer.from(signatureHeader);

  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}
