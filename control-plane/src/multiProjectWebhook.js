import express from "express";
import { verifyGithubSignature } from "./hmac.js";
import { parsePushEvent } from "./pushEvent.js";
import { parseDeleteEvent } from "./deleteEvent.js";

// Each linked project gets its own webhook secret and its own registered
// URL (/webhook/github/:projectId), so the project — and therefore which
// secret to verify against — is known from the URL before the body is
// even parsed.
//
// Mount this at "/webhook" (not "/"): its raw-body middleware applies to
// every request that enters the router, so mounting under a path prefix
// keeps it from swallowing bodies meant for express.json() elsewhere in
// the app.
export function createMultiProjectWebhookRouter({ getProjectById, onPush, onDelete }) {
  const router = express.Router();
  router.use(express.raw({ type: "application/json", limit: "10mb" }));

  router.post("/github/:projectId", (req, res) => {
    const project = getProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).send("unknown project");
    }

    const signature = req.get("X-Hub-Signature-256");
    if (!verifyGithubSignature(project.webhook_secret, req.body, signature)) {
      return res.status(401).send("invalid signature");
    }

    const event = req.get("X-GitHub-Event");
    const payload =
      event === "push" || event === "delete" ? JSON.parse(req.body.toString("utf8")) : null;

    if (event === "push") {
      onPush(parsePushEvent(payload), project, payload);
    } else if (event === "delete" && onDelete) {
      onDelete(parseDeleteEvent(payload), project, payload);
    } else {
      return res.status(202).send("ignored");
    }

    res.status(200).send("ok");
  });

  return router;
}
