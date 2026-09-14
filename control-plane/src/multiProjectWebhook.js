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
export function createMultiProjectWebhookRouter({ getProjectById, onPush, onDelete, onDelivery }) {
  const router = express.Router();
  router.use(express.raw({ type: "application/json", limit: "10mb" }));

  router.post("/github/:projectId", (req, res) => {
    const project = getProjectById(req.params.projectId);
    if (!project) {
      return res.status(404).send("unknown project");
    }

    const deliveryId = req.get("X-GitHub-Delivery");
    const event = req.get("X-GitHub-Event");
    const signature = req.get("X-Hub-Signature-256");

    if (!verifyGithubSignature(project.webhook_secret, req.body, signature)) {
      onDelivery?.({
        project,
        event,
        deliveryId,
        status: "invalid_signature",
        detail: "HMAC signature verification failed",
      });
      return res.status(401).send("invalid signature");
    }

    try {
      const payload =
        event === "push" || event === "delete" ? JSON.parse(req.body.toString("utf8")) : null;

      if (event === "push") {
        const parsed = parsePushEvent(payload);
        onDelivery?.({
          project,
          event,
          deliveryId,
          status: "ok",
          detail: `push to ${parsed.branch} (${parsed.sha.slice(0, 7)})`,
        });
        onPush(parsed, project, payload);
      } else if (event === "delete" && onDelete) {
        const parsed = parseDeleteEvent(payload);
        onDelivery?.({
          project,
          event,
          deliveryId,
          status: "ok",
          detail: `delete ${parsed.refType} ${parsed.branch}`,
        });
        onDelete(parsed, project, payload);
      } else {
        onDelivery?.({ project, event, deliveryId, status: "ignored", detail: `event ignored: ${event}` });
        return res.status(202).send("ignored");
      }
    } catch (err) {
      onDelivery?.({ project, event, deliveryId, status: "error", detail: err.message });
      return res.status(400).send(`error processing webhook: ${err.message}`);
    }

    res.status(200).send("ok");
  });

  return router;
}
