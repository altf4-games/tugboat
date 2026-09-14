import { describe, it, expect } from "vitest";
import {
  openDb,
  createDeployment,
  appendDeploymentLog,
  setDeploymentStatus,
  setDeploymentUrl,
  markDeploymentProduction,
  getDeployment,
  listDeployments,
  createProject,
  getProjectByRepo,
  listProjects,
  deleteProject,
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

  it("filters deployments by repo when asked", () => {
    const db = openDb(":memory:");
    createDeployment(db, { repo: "org/app-a", branch: "main", sha: "sha1" });
    const idB = createDeployment(db, { repo: "org/app-b", branch: "main", sha: "sha2" });

    const rows = listDeployments(db, { repo: "org/app-b" });
    expect(rows.map((r) => r.id)).toEqual([idB]);
  });

  it("records a deployment's preview URL and production flag", () => {
    const db = openDb(":memory:");
    const id = createDeployment(db, { repo: "org/app", branch: "main", sha: "sha1" });

    setDeploymentUrl(db, id, "https://sha1.127.0.0.1.nip.io");
    markDeploymentProduction(db, id);

    const row = getDeployment(db, id);
    expect(row.preview_url).toBe("https://sha1.127.0.0.1.nip.io");
    expect(row.is_production).toBe(1);
  });
});

describe("projects", () => {
  it("creates and reads back a linked project", () => {
    const db = openDb(":memory:");
    createProject(db, {
      repo: "org/app",
      ownerLogin: "org",
      defaultBranch: "main",
      cloneUrl: "https://github.com/org/app.git",
      hookId: 123,
      accessToken: "gho_fake",
      webhookSecret: "secret",
    });

    const project = getProjectByRepo(db, "org/app");
    expect(project.repo).toBe("org/app");
    expect(project.default_branch).toBe("main");
    expect(project.hook_id).toBe(123);
  });

  it("upserts on repeated linking of the same repo", () => {
    const db = openDb(":memory:");
    createProject(db, {
      repo: "org/app",
      ownerLogin: "org",
      defaultBranch: "main",
      cloneUrl: "https://github.com/org/app.git",
      hookId: 1,
      accessToken: "gho_old",
      webhookSecret: "secret",
    });
    createProject(db, {
      repo: "org/app",
      ownerLogin: "org",
      defaultBranch: "main",
      cloneUrl: "https://github.com/org/app.git",
      hookId: 2,
      accessToken: "gho_new",
      webhookSecret: "secret",
    });

    expect(listProjects(db)).toHaveLength(1);
    expect(getProjectByRepo(db, "org/app").hook_id).toBe(2);
    expect(getProjectByRepo(db, "org/app").access_token).toBe("gho_new");
  });

  it("deletes a project by repo", () => {
    const db = openDb(":memory:");
    createProject(db, {
      repo: "org/app",
      ownerLogin: "org",
      defaultBranch: "main",
      cloneUrl: "https://github.com/org/app.git",
      hookId: 1,
      accessToken: "gho_fake",
      webhookSecret: "secret",
    });

    deleteProject(db, "org/app");
    expect(getProjectByRepo(db, "org/app")).toBeUndefined();
  });
});
