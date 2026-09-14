# Tugboat

A self-hosted, Vercel/Railway-style PaaS. Push a branch and it's built into a
container with no Dockerfile, given a live local URL and a real public HTTPS
link, and — on merge to `main` — zero-downtime promoted to a production
route with rollback support.

Built entirely from real open-source infrastructure, driven by a single
Node.js control plane:

```
push → build → route → promote → rollback
 │       │       │        │          │
 │       │       │        │          └─ re-point production at a previous image
 │       │       │        └─ blue-green swap with a real health check
 │       │       └─ Traefik auto-discovers the container, no config edits
 │       └─ Cloud Native Buildpacks (pack) turns the repo into an image
 └─ GitHub webhook, HMAC-verified
```

| Concern | Tool |
|---|---|
| Build | [Cloud Native Buildpacks](https://buildpacks.io/) (`pack` CLI, Paketo builders) |
| Container runtime | Docker (developed against [OrbStack](https://orbstack.dev/)) |
| Routing | [Traefik](https://traefik.io/) (Docker provider for previews, file provider for production) |
| Public links | [Cloudflare Tunnel](https://github.com/cloudflare/cloudflared) (`cloudflared` quick tunnels) |
| Storage | SQLite (`better-sqlite3`) for the deployment dashboard |

Every feature was built test-first against **real** infrastructure — a real
`pack build`, a real Docker daemon, a real Traefik instance, a real GitHub
webhook delivery, a real Cloudflare tunnel. Nothing is mocked and no data is
seeded.

## Project structure

```
sample-app/       real minimal Express app — the subject that gets built and deployed
control-plane/    the orchestrator: webhook listener, build/route/promote/rollback logic, dashboard
  src/            one real capability per module (see table below)
  tests/          *.unit.test.js = pure logic, *.integration.test.js = real infra, no mocks
  docker/         nginx config used to work around a real Traefik/OrbStack API-version bug
scripts/          reserved for standalone CLI wrappers (currently unused — promote/rollback
                  are plain importable functions in control-plane/src/)
```

### What each module does

| Module | Responsibility |
|---|---|
| `hmac.js` / `pushEvent.js` / `deleteEvent.js` | Verify and parse real GitHub webhook payloads |
| `webhookServer.js` | Express endpoint wiring signature verification to push/delete handlers |
| `buildImage.js` / `buildWithLogging.js` | Shell out to `pack build`, optionally streaming live logs |
| `onPushBuild.js` | Connects a verified push to a real build, without blocking the webhook response |
| `dockerLabels.js` / `runAppContainer.js` | Traefik-labelled preview containers, one per branch |
| `traefikController.js` | Starts Traefik (Docker provider + file provider) with an OrbStack API-version workaround |
| `productionRoute.js` / `promote.js` | Blue-green production swap via Traefik's file provider |
| `rollback.js` / `deploymentHistory.js` | Re-promote a previous image from real promotion history |
| `tunnelManager.js` / `cloudflaredUrl.js` | Spawn a `cloudflared` tunnel, parse its real assigned URL |
| `previewRegistry.js` / `onDeleteTeardown.js` | Tear down a branch's container, route, and tunnel on delete |
| `resourceLimits.js` | Translate memory/CPU quotas into real `docker run` flags |
| `db.js` / `dashboardServer.js` | SQLite-backed deployment history with a live build-log stream (SSE) |

## Prerequisites

Developed and tested on macOS (Apple Silicon, OrbStack). You need:

```bash
brew install --cask docker            # or use OrbStack — anything that provides a working `docker` CLI
brew install buildpacks/tap/pack      # Cloud Native Buildpacks CLI
brew install cloudflare/cloudflare/cloudflared
brew install node                     # Node 20+
```

Plus:

- **Docker running** (`docker info` should succeed) before doing anything else.
- **GitHub CLI authenticated** with `repo` scope (`gh auth login`) — the
  integration tests create and delete a real webhook and push/delete real
  throwaway branches on this repo's `origin` remote.
- A `git remote origin` pointing at a real GitHub repo you can push to (the
  webhook/tunnel/teardown tests derive the repo name from it).

No Traefik install needed — it runs as a container, pulled automatically.

## Setup

```bash
cd sample-app && npm install
cd ../control-plane && npm install
```

That's it — there's no `.env` or config file to fill in. Tests create their
own throwaway secrets, ports, and container/branch names at runtime.

## How to test this yourself

Run the full suite from `control-plane/`:

```bash
cd control-plane
npm test
```

This is the real, meaningful way to verify the whole system — it doesn't
just check logic, it actually stands up the infrastructure and proves it
works:

- runs a **real** `pack build` against `sample-app/`
- registers a **real** webhook on your GitHub repo, fires a **real** push
  through a **real** `cloudflared` tunnel, and asserts your control plane
  received and parsed it correctly
- starts a **real** Traefik container and proves it auto-routes a freshly
  started container with zero config edits and zero restarts
- gets a **real** public `https://*.trycloudflare.com` link and hits it
  over the real internet
- runs a **real continuous HTTP load** across two production promotes and
  asserts **zero dropped requests**
- rolls back and confirms (via `docker inspect`, not a mock) that the
  previous image's container is genuinely running again
- streams **real** `pack build` output live over Server-Sent Events while
  the build is still in progress
- pushes then deletes a real branch and confirms the container, Traefik
  route, and tunnel are all actually gone
- gives a container a 20MB memory limit, deliberately exceeds it, and
  confirms Docker's real OOM killer actually killed it

Expect this to take **several minutes** (multiple real `pack build`s, real
container startups, real network round-trips to GitHub and Cloudflare) —
that's the cost of testing against real infrastructure instead of mocks.

### Side effects you should know about

The integration tests are self-cleaning, but while running they will, for
real, against your `origin` GitHub repo:

- create and delete a webhook (events: `push`, `delete`)
- push and delete a handful of `webhook-test/*`, `build-test/*`,
  `teardown-test/*` branches
- pull several public Docker images (`traefik`, `nginx:alpine`,
  `node:20-alpine`) and build/run/remove a number of local containers

Everything is torn down in `finally`/`afterAll` blocks, but if a run is
killed mid-test, clean up manually with:

```bash
docker ps -a --filter "name=tugboat" --format "{{.Names}}" | xargs -r docker rm -f
gh api repos/<owner>/<repo>/hooks   # check for and delete any leftover webhook
```

### Running a subset

Each phase has its own test file, so you can run just the one you care about
instead of the whole suite:

```bash
npx vitest run tests/phase0.pack-build.smoke.test.js   # Phase 0: build sanity check
npx vitest run tests/webhook.integration.test.js        # Phase 1: webhook ingestion
npx vitest run tests/build.integration.test.js           # Phase 2: push → build
npx vitest run tests/traefik.integration.test.js         # Phase 3: auto-routing
npx vitest run tests/tunnel.integration.test.js           # Phase 4: public links
npx vitest run tests/promote.integration.test.js          # Phase 5: blue-green promote
npx vitest run tests/rollback.integration.test.js          # Phase 6: rollback
npx vitest run tests/dashboard.integration.test.js         # Phase 7: live log streaming
npx vitest run tests/teardown.integration.test.js           # Phase 8: branch-delete teardown
npx vitest run tests/resourceLimits.integration.test.js     # Phase 9: memory/CPU limits
```

`*.unit.test.js` files (HMAC, payload parsing, label/route construction,
SQLite, etc.) are pure logic and run in milliseconds with no side effects —
safe to run anytime, including in a watch loop:

```bash
npm run test:watch
```

### A known source of flakiness

A handful of integration tests depend on a real `cloudflared` quick tunnel
and a real GitHub webhook delivery landing within the test's timeout. These
occasionally fail with a timeout under normal network conditions — that's
genuine external-network variance, not a bug in the code (each one has been
re-run and confirmed to pass reliably on retry throughout development). If
one fails, rerun just that file before assuming something's broken.

## Trying it by hand

To see the subject app run on its own, independent of the pipeline:

```bash
cd sample-app
npm install
npm start
# in another terminal:
curl localhost:3000/
curl localhost:3000/health
```

To watch a real buildpacks build happen:

```bash
pack build tugboat/sample-app:manual --path sample-app --builder paketobuildpacks/builder-jammy-base --trust-builder
docker run --rm -p 3000:3000 tugboat/sample-app:manual
```
