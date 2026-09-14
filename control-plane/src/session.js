import crypto from "node:crypto";

const sessions = new Map();

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

export function createSession(data, secret) {
  const id = crypto.randomBytes(24).toString("hex");
  sessions.set(id, data);
  return `${id}.${sign(id, secret)}`;
}

export function getSession(cookieValue, secret) {
  if (!cookieValue) return null;
  const [id, signature] = cookieValue.split(".");
  if (!id || !signature) return null;

  const expected = Buffer.from(sign(id, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  return sessions.get(id) ?? null;
}

export function destroySession(cookieValue) {
  const [id] = (cookieValue ?? "").split(".");
  if (id) sessions.delete(id);
}
