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
