import express from "express";
import { verifyGithubSignature } from "./hmac.js";
import { parsePushEvent } from "./pushEvent.js";

export function createWebhookServer({ secret, onPush }) {
  const app = express();
  app.use(express.raw({ type: "application/json", limit: "10mb" }));

  app.post("/webhook/github", (req, res) => {
    const signature = req.get("X-Hub-Signature-256");

    if (!verifyGithubSignature(secret, req.body, signature)) {
      return res.status(401).send("invalid signature");
    }

    const event = req.get("X-GitHub-Event");
    if (event !== "push") {
      return res.status(202).send("ignored");
    }

    const payload = JSON.parse(req.body.toString("utf8"));
    onPush(parsePushEvent(payload), payload);

    res.status(200).send("ok");
  });

  return app;
}
