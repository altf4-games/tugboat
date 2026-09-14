import express from "express";
import { listDeployments, getDeployment } from "./db.js";

const DASHBOARD_HTML = `<!doctype html>
<html>
<head><title>Tugboat</title></head>
<body>
<h1>Deployments</h1>
<ul id="deployments"></ul>
<pre id="log"></pre>
<script>
async function loadDeployments() {
  const res = await fetch('/api/deployments');
  const deployments = await res.json();
  const list = document.getElementById('deployments');
  list.innerHTML = '';
  for (const d of deployments) {
    const li = document.createElement('li');
    li.textContent = d.repo + '@' + d.branch + ' (' + d.sha.slice(0, 7) + ') - ' + d.status;
    li.onclick = () => streamLog(d.id);
    list.appendChild(li);
  }
}

function streamLog(id) {
  const log = document.getElementById('log');
  log.textContent = '';
  const source = new EventSource('/api/deployments/' + id + '/stream');
  source.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.chunk) log.textContent += payload.chunk;
    if (payload.done) source.close();
  };
}

loadDeployments();
</script>
</body>
</html>`;

export function createDashboardServer({ db, liveBuilds }) {
  const app = express();

  app.get("/api/deployments", (req, res) => {
    res.json(listDeployments(db));
  });

  app.get("/api/deployments/:id/stream", (req, res) => {
    const id = Number(req.params.id);
    const deployment = getDeployment(db, id);
    if (!deployment) {
      res.status(404).end();
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Catch-up with whatever has already been logged, then switch to live
    // events for anything still in progress.
    res.write(`data: ${JSON.stringify({ chunk: deployment.log })}\n\n`);

    const emitter = liveBuilds.get(id);
    if (!emitter || deployment.status !== "building") {
      res.write(`data: ${JSON.stringify({ done: true, status: deployment.status })}\n\n`);
      res.end();
      return;
    }

    const onLog = (text) => res.write(`data: ${JSON.stringify({ chunk: text })}\n\n`);
    const onDone = (result) => {
      res.write(`data: ${JSON.stringify({ done: true, status: result.status })}\n\n`);
      res.end();
    };

    emitter.on("log", onLog);
    emitter.once("done", onDone);

    req.on("close", () => {
      emitter.off("log", onLog);
      emitter.off("done", onDone);
    });
  });

  app.get("/", (req, res) => {
    res.type("html").send(DASHBOARD_HTML);
  });

  return app;
}
