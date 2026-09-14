import Database from "better-sqlite3";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = path.resolve(__dirname, "../data/tugboat.db");

// Columns added after a table's original CREATE TABLE shipped. Listed here
// so an existing database file (from before the column existed) gets
// migrated forward instead of erroring with "no such column" — CREATE
// TABLE IF NOT EXISTS only handles brand-new databases, not evolving ones.
const COLUMN_MIGRATIONS = {
  deployments: [
    ["preview_url", "TEXT"],
    ["is_production", "INTEGER NOT NULL DEFAULT 0"],
  ],
  projects: [["root_directory", "TEXT NOT NULL DEFAULT ''"]],
};

function migrateColumns(db) {
  for (const [table, columns] of Object.entries(COLUMN_MIGRATIONS)) {
    const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
    for (const [name, definition] of columns) {
      if (!existing.has(name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      }
    }
  }
}

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
      preview_url TEXT,
      is_production INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo TEXT NOT NULL UNIQUE,
      owner_login TEXT NOT NULL,
      default_branch TEXT NOT NULL,
      clone_url TEXT NOT NULL,
      hook_id INTEGER,
      access_token TEXT NOT NULL,
      webhook_secret TEXT NOT NULL,
      root_directory TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );
  `);
  migrateColumns(db);
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

export function setDeploymentUrl(db, id, previewUrl) {
  db.prepare("UPDATE deployments SET preview_url = ? WHERE id = ?").run(previewUrl, id);
}

export function markDeploymentProduction(db, id) {
  db.prepare("UPDATE deployments SET is_production = 1 WHERE id = ?").run(id);
}

export function getDeployment(db, id) {
  return db.prepare("SELECT * FROM deployments WHERE id = ?").get(id);
}

export function listDeployments(db, { repo } = {}) {
  if (repo) {
    return db
      .prepare("SELECT * FROM deployments WHERE repo = ? ORDER BY created_at DESC, id DESC")
      .all(repo);
  }
  return db.prepare("SELECT * FROM deployments ORDER BY created_at DESC, id DESC").all();
}

export function createProject(
  db,
  {
    repo,
    ownerLogin,
    defaultBranch,
    cloneUrl,
    hookId,
    accessToken,
    webhookSecret,
    rootDirectory = "",
  },
) {
  const result = db
    .prepare(
      `INSERT INTO projects (repo, owner_login, default_branch, clone_url, hook_id, access_token, webhook_secret, root_directory, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(repo) DO UPDATE SET
         owner_login = excluded.owner_login,
         default_branch = excluded.default_branch,
         clone_url = excluded.clone_url,
         hook_id = excluded.hook_id,
         access_token = excluded.access_token,
         webhook_secret = excluded.webhook_secret,
         root_directory = excluded.root_directory`,
    )
    .run(
      repo,
      ownerLogin,
      defaultBranch,
      cloneUrl,
      hookId,
      accessToken,
      webhookSecret,
      rootDirectory,
      Date.now(),
    );
  return getProjectByRepo(db, repo).id ?? result.lastInsertRowid;
}

export function getProjectByRepo(db, repo) {
  return db.prepare("SELECT * FROM projects WHERE repo = ?").get(repo);
}

export function getProjectById(db, id) {
  return db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
}

export function setProjectHookId(db, id, hookId) {
  db.prepare("UPDATE projects SET hook_id = ? WHERE id = ?").run(hookId, id);
}

export function listProjects(db) {
  return db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
}

export function deleteProject(db, repo) {
  db.prepare("DELETE FROM projects WHERE repo = ?").run(repo);
}
