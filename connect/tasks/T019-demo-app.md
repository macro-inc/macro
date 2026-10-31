# T019: Demo customer app at `connect-dev.macro.com/demo`

Base: `eric/macro-connect` (PR #9231). Branch for review: `eric/macro-connect-demo`.

## Goal

A person opens `https://connect-dev.macro.com/demo`, sees Connect's catalog,
connects an app through a real vendor consent, and runs that vendor's MCP
tools through Connect's gateway, all from one page. The demo is a separate
customer of Connect: it talks to Connect only through `connect_client` with
its own customer key, exactly as Macro will.

## Context

- `connect/crates/connect_client` (public client, `mcp_upstream`),
  `connect/services/connect_api` (routes, `create-customer` CLI),
  `connect/infra/index.ts` (ALB, listeners, ECS service, Secrets Manager
  runtime JSON), `connect/docs/runbooks/bootstrap.md`.
- The dev stack is deployed by the planner; do not run `pulumi` against AWS.

## Do

1. **Service** `connect/services/connect_demo` (package `connect_demo`, axum,
   depends only on `connect_client`, `connect_platform`, and ordinary crates;
   the boundary rules apply). Config through `connect_platform`:
   `CONNECT_BASE_URL`, `CONNECT_DEMO_CUSTOMER_KEY`, `CONNECT_DEMO_PUBLIC_URL`
   (e.g. `https://connect-dev.macro.com/demo`). Everything under `/demo`;
   `/demo/health` for the target group.
   - Each browser gets an opaque random demo user id in a `Secure`,
     `HttpOnly`, `SameSite=Lax` cookie; it is the `external_user_id`.
   - `GET /demo`: one server-rendered HTML page (no frontend build; small
     inline CSS and vanilla JS are fine). Shows every catalog entry with icon,
     name, description, `MCP` / `MCP + API` label, and per app either
     **Connect** or **Connected** with **Disconnect** and **Try it**.
   - `POST /demo/connect/{app_id}`: creates a connect session with redirect
     `<public>/demo/connected?app=<id>` and 303s to `connect_url`.
     `GET /demo/connected` shows success or the error Connect returned, then
     links back.
   - `POST /demo/apps/{app_id}/tools` lists the app's MCP tools through
     Connect's gateway (MCP `initialize`, `notifications/initialized`,
     `tools/list`, honoring `Mcp-Session-Id`, JSON or SSE responses).
     `POST /demo/apps/{app_id}/call` runs one tool with JSON arguments typed
     by the user and shows the result. Render results as escaped,
     pretty-printed JSON.
   - Never expose the customer key or vendor tokens to the browser; never
     call `access_token`.
   - Span the MCP calls (`demo.mcp_list_tools`, `demo.mcp_call_tool`) with
     `app_id` and outcome; no tool arguments or results in spans.
   - Dockerfile like `connect_api`'s.
2. **Infra** in `connect/infra/index.ts`: an ECR image for `connect_demo`, its
   own task definition and ECS service (1 task) on the existing cluster, its
   own security group reachable only from the ALB, a target group with health
   check `/demo/health`, and an HTTPS listener rule sending `/demo` and
   `/demo/*` to it. Its runtime JSON (`CONNECT_BASE_URL`,
   `CONNECT_DEMO_PUBLIC_URL`, `CONNECT_DEMO_CUSTOMER_KEY`) lives in its own
   Secrets Manager secret. The key comes from encrypted Pulumi config
   `demoCustomerKey`; when it is unset, create none of the demo resources so
   the stack still deploys.
3. **Local**: add `connect_demo` to `connect/docker-compose.yml` (port
   `CONNECT_DEMO_PORT`, default 3000, public URL `http://localhost:3000/demo`),
   reading the key from `CONNECT_DEMO_CUSTOMER_KEY` in the environment.
4. **Tests**: handler tests against a fake Connect (wiremock or an in-process
   axum stub) covering the page rendering (labels, connected state, HTML
   escaping of vendor-supplied text), the connect redirect, the cookie, and
   the MCP list/call flow including an SSE response and a session id.
5. **Docs**: `connect/services/connect_demo/AGENTS.md` (+ `CLAUDE.md`
   symlink); a "Demo" section in `bootstrap.md` (create the demo customer
   with redirect origin `https://connect-dev.macro.com`, set
   `demoCustomerKey`, deploy); `connect/AGENTS.md` map.

## Done when

- Compose runs Connect and the demo; `http://localhost:3000/demo` lists the
  live apps and **Connect** for Linear 303s to Connect and then to
  `mcp.linear.app`'s authorize endpoint (paste the `Location` hosts).
- `cargo nextest run --all-features -p connect_demo -p connect_client -p connect_api`,
  clippy (`-D warnings`) for those, `cargo x deps --check`, `just check`, and
  in `connect/infra`: `bunx tsc --noEmit`, `bunx biome check .` pass.
- Nothing outside `connect/` changes except workspace membership and
  generated Cargo artifacts.

## Out of scope

Real vendor consent (the planner does it in the browser); deploying; a
frontend build; user accounts beyond the cookie.

## Result

### Changed

- `connect/services/connect_demo/{Cargo.toml,Dockerfile,AGENTS.md,CLAUDE.md,src/main.rs,src/mcp.rs,src/mcp/test.rs,src/test.rs,src/style.css,src/app.js}`: standalone server-rendered demo with a browser identity cookie, catalog and connection controls, JSON and SSE MCP tool flows, escaped results, tracing spans, and handler tests. The JavaScript ignores stale asynchronous responses.
- `connect/crates/connect_client/{AGENTS.md,src/lib.rs,src/test.rs}`: expose catalog icons through the public client and cover the route.
- `connect/infra/{index.ts,AGENTS.md}`: optional demo image, secret, task, service, security group, target group, and HTTPS listener rule, all gated on encrypted `demoCustomerKey` config.
- `connect/{docker-compose.yml,AGENTS.md}` and `connect/docs/runbooks/bootstrap.md`: local demo service and documented local and dev bootstrap. The agent maps now include the demo.
- `Cargo.toml`, `Cargo.lock`, and `.github/workspace-dep-closures.json`: workspace membership and generated dependency artifacts.
- `connect/tasks/T019-demo-app.md`: this handoff result. `connect/STATUS.md` was not changed.

### Checks

All Rust and repository tooling ran inside `nix develop --command` with `CARGO_TARGET_DIR="$CONNECT_CARGO_TARGET_DIR"` and `DATABASE_URL="$CONNECT_DATABASE_URL"` exported. No AWS Pulumi command, deployment, production access, or vendor consent was run.

| Check | Exact outcome |
| --- | --- |
| `just hakari` | Passed; regenerated workspace dependency closure. |
| `cargo nextest run --all-features -p connect_demo -p connect_client -p connect_api` | Passed; 31 tests, 0 skipped. |
| `cargo clippy -p connect_demo -p connect_client -p connect_api --all-features --all-targets -- -D warnings` | Passed, exit 0. |
| `cargo x deps --check` | Passed, exit 0. |
| `just check` | Passed; format, ast-grep, PII scan, and 12 PII scanner tests. |
| `bun install --frozen-lockfile` in `connect/infra` | Passed; lockfile unchanged. |
| `bunx tsc --noEmit` in `connect/infra` | Passed, exit 0. |
| `bunx biome check .` in `connect/infra` | Passed; 4 files checked, no fixes. |
| `docker compose -f connect/docker-compose.yml config --quiet` | Passed, exit 0. |
| Compose build and run | Passed; API and demo images built and both services started. Host port 8080 was occupied, so the API used `CONNECT_PORT=18673`; demo used port 3000. |
| Live HTTP and redirect chain | API `/health` 200; demo `/demo/health` 200; `/demo` 200 with Linear and Connect; `POST /demo/connect/linear` 303 with `Location` host `localhost`; Connect authorization 303 with `Location` host `mcp.linear.app`. |
| Browser rendering | Passed in headless Chromium at desktop and 390 px mobile widths; catalog, icons, controls, and one-column mobile layout were visually checked. |
| Audit skill | Passed; no remaining concrete code regression or out-of-scope change found. |
| `git diff --check` | Passed, exit 0. |
| Runtime trace export | Not verified; no local trace exporter was configured. Span names and attributes were reviewed in code. |

### Open questions

None.

### Proposed commits

1. `feat(connect-demo): add catalog and MCP customer app`

   Why: A standalone customer app is needed to exercise the public catalog, connection flow, and MCP gateway.

   What: Add the demo service, client icon method, tests, workspace membership, and generated Cargo artifacts.

2. `feat(connect-infra): route optional demo service`

   Why: The demo needs isolated runtime configuration and a route on the existing HTTPS listener.

   What: Add optional infrastructure resources and the local Compose service.

3. `docs(connect): document demo bootstrap`

   Why: The setup steps and repository map must describe the new service.

   What: Update the bootstrap runbook and agent guides, and record the task result.
