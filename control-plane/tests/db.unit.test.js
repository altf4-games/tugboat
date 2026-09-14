import { describe, it, expect } from "vitest";
import {
  openDb,
  createDeployment,
  appendDeploymentLog,
  setDeploymentStatus,
  getDeployment,
  listDeployments,
} from "../src/db.js";

describe("db (real SQLite via better-sqlite3)", () => {
  it("creates a deployment row and reads it back", () => {
    const db = openDb(":memory:");
    const id = createDeployment(db, { repo: "org/app", branch: "main", sha: "abc123" });

    const row = getDeployment(db, id);
    expect(row.repo).toBe("org/app");
    expect(row.branch).toBe("main");
    expect(row.sha).toBe("abc123");
    expect(row.status).toBe("building");
    expect(row.log).toBe("");
  });

  it("appends log chunks as they arrive, in order", () => {
    const db = openDb(":memory:");
    const id = createDeployment(db, { repo: "org/app", branch: "main", sha: "abc123" });

    appendDeploymentLog(db, id, "===> DETECTING\n");
    appendDeploymentLog(db, id, "===> BUILDING\n");

    expect(getDeployment(db, id).log).toBe("===> DETECTING\n===> BUILDING\n");
  });

  it("updates status and image tag on completion", () => {
    const db = openDb(":memory:");
    const id = createDeployment(db, { repo: "org/app", branch: "main", sha: "abc123" });

    setDeploymentStatus(db, id, "success", { imageTag: "org/app:abc123" });

    const row = getDeployment(db, id);
    expect(row.status).toBe("success");
    expect(row.image_tag).toBe("org/app:abc123");
  });

  it("lists deployments newest first", () => {
    const db = openDb(":memory:");
    const id1 = createDeployment(db, { repo: "org/app", branch: "main", sha: "sha1" });
    const id2 = createDeployment(db, { repo: "org/app", branch: "main", sha: "sha2" });

    const rows = listDeployments(db);
    expect(rows.map((r) => r.id)).toEqual([id2, id1]);
  });
});
