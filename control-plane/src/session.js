import crypto from "node:crypto";

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

// Sessions are persisted in SQLite (not an in-memory Map) specifically so a
// server restart doesn't force everyone to sign in again — during local
// development the server gets restarted a lot.
export function createSession(db, data, secret) {
  const id = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (id, data, created_at) VALUES (?, ?, ?)").run(
    id,
    JSON.stringify(data),
    Date.now(),
  );
  return `${id}.${sign(id, secret)}`;
}

export function getSession(db, cookieValue, secret) {
  if (!cookieValue) return null;
  const [id, signature] = cookieValue.split(".");
  if (!id || !signature) return null;

  const expected = Buffer.from(sign(id, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  const row = db.prepare("SELECT data FROM sessions WHERE id = ?").get(id);
  return row ? JSON.parse(row.data) : null;
}

export function destroySession(db, cookieValue) {
  const [id] = (cookieValue ?? "").split(".");
  if (id) db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
}
