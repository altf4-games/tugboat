import express from "express";
import { verifyGithubSignature } from "./hmac.js";
import { parsePushEvent } from "./pushEvent.js";
import { parseDeleteEvent } from "./deleteEvent.js";

export function createWebhookRouter({ secret, onPush, onDelete }) {
  const router = express.Router();
  router.use(express.raw({ type: "application/json", limit: "10mb" }));

  router.post("/webhook/github", (req, res) => {
    const signature = req.get("X-Hub-Signature-256");

    if (!verifyGithubSignature(secret, req.body, signature)) {
      return res.status(401).send("invalid signature");
    }

    const event = req.get("X-GitHub-Event");
    const payload =
      event === "push" || event === "delete" ? JSON.parse(req.body.toString("utf8")) : null;

    if (event === "push") {
      onPush(parsePushEvent(payload), payload);
    } else if (event === "delete" && onDelete) {
      onDelete(parseDeleteEvent(payload), payload);
    } else {
      return res.status(202).send("ignored");
    }

    res.status(200).send("ok");
  });

  return router;
}

export function createWebhookServer(options) {
  const app = express();
  app.use(createWebhookRouter(options));
  return app;
}
