import express from "express";

const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.json({ service: "tugboat-sample-app", status: "ok" });
});

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

app.listen(port, () => {
  console.log(`tugboat-sample-app listening on port ${port}`);
});
