import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "node:http";
import { createMultiProjectWebhookRouter } from "../src/multiProjectWebhook.js";
import { computeGithubSignature } from "../src/hmac.js";

const projects = {
  1: { id: 1, repo: "org/app-a", webhook_secret: "secret-a" },
  2: { id: 2, repo: "org/app-b", webhook_secret: "secret-b" },
};

let server;
let baseUrl;
const receivedPushes = [];
const receivedDeletes = [];

async function postWebhook({ projectId, event, secret, body }) {
  const raw = Buffer.from(JSON.stringify(body));
  const signature = computeGithubSignature(secret, raw);
  return fetch(`${baseUrl}/webhook/github/${projectId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-Hub-Signature-256": signature,
    },
    body: raw,
  });
}

describe("multiProjectWebhook: routes by project id and verifies that project's own secret", () => {
  beforeAll(async () => {
    const app = express();
    app.use(
      "/webhook",
      createMultiProjectWebhookRouter({
        getProjectById: (id) => projects[id],
        onPush: (parsed, project) => receivedPushes.push({ parsed, project }),
        onDelete: (parsed, project) => receivedDeletes.push({ parsed, project }),
      }),
    );
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("accepts a push signed with the correct project's secret and routes it to that project", async () => {
    const res = await postWebhook({
      projectId: 1,
      event: "push",
      secret: "secret-a",
      body: {
        ref: "refs/heads/main",
        after: "abc123",
        repository: { full_name: "org/app-a" },
      },
    });

    expect(res.status).toBe(200);
    expect(receivedPushes).toHaveLength(1);
    expect(receivedPushes[0].project.repo).toBe("org/app-a");
    expect(receivedPushes[0].parsed.branch).toBe("main");
    expect(receivedPushes[0].parsed.sha).toBe("abc123");
  });

  it("rejects a request signed with a different project's secret", async () => {
    const res = await postWebhook({
      projectId: 1,
      event: "push",
      secret: "secret-b", // wrong secret for project 1
      body: {
        ref: "refs/heads/main",
        after: "def456",
        repository: { full_name: "org/app-a" },
      },
    });

    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown project id", async () => {
    const res = await postWebhook({
      projectId: 999,
      event: "push",
      secret: "doesnt-matter",
      body: { ref: "refs/heads/main", after: "x", repository: { full_name: "org/nope" } },
    });

    expect(res.status).toBe(404);
  });

  it("routes a delete event to that project's onDelete handler", async () => {
    const res = await postWebhook({
      projectId: 2,
      event: "delete",
      secret: "secret-b",
      body: { ref: "feature-branch", ref_type: "branch", repository: { full_name: "org/app-b" } },
    });

    expect(res.status).toBe(200);
    expect(receivedDeletes).toHaveLength(1);
    expect(receivedDeletes[0].project.repo).toBe("org/app-b");
    expect(receivedDeletes[0].parsed.branch).toBe("feature-branch");
  });
});
