import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = path.resolve(__dirname, "../data/tugboat.db");

export function openDb(dbPath = DEFAULT_DB_PATH) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS deployments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      sha TEXT NOT NULL,
      image_tag TEXT,
      status TEXT NOT NULL DEFAULT 'building',
      log TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )
  `);
  return db;
}

export function createDeployment(db, { repo, branch, sha }) {
  const result = db
    .prepare(
      `INSERT INTO deployments (repo, branch, sha, status, log, created_at)
       VALUES (?, ?, ?, 'building', '', ?)`,
    )
    .run(repo, branch, sha, Date.now());
  return result.lastInsertRowid;
}

export function appendDeploymentLog(db, id, chunk) {
  db.prepare("UPDATE deployments SET log = log || ? WHERE id = ?").run(chunk, id);
}

export function setDeploymentStatus(db, id, status, { imageTag } = {}) {
  if (imageTag) {
    db.prepare("UPDATE deployments SET status = ?, image_tag = ? WHERE id = ?").run(
      status,
      imageTag,
      id,
    );
  } else {
    db.prepare("UPDATE deployments SET status = ? WHERE id = ?").run(status, id);
  }
}

export function getDeployment(db, id) {
  return db.prepare("SELECT * FROM deployments WHERE id = ?").get(id);
}

export function listDeployments(db) {
  return db.prepare("SELECT * FROM deployments ORDER BY created_at DESC, id DESC").all();
}
