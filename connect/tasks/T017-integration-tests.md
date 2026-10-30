# T017: `connect_client` on this branch, and integration tests

Base: `eric/macro-connect` (PR #9231).

## Goal

One command runs Connect's integration tests against any running Connect, the
local Compose stack or `https://connect-dev.macro.com`, through the public
client, and fails loudly on any broken behavior. It proves each live app's
real OAuth handshake up to the vendor's consent page without a test account.

## Context

- `connect_client` was built on an older base: branch
  `connect/T009-connect-client`, commit `9f1d2070fe` (and its spec
  `connect/tasks/T009-connect-client.md` there). This branch has since moved
  routes to the host root, removed Doppler, isolated test databases, and made
  `connect_platform` the AWS wrapper. Port it; don't merge the old branch.
- `connect/docker-compose.yml`, `connect/docs/runbooks/bootstrap.md`,
  `connect_api` (`create-customer`, routes, OpenAPI).

## Do

1. **Port `connect_client`** onto this branch (crate, shared wire types used
   by `connect_api`, `traceparent` injection in `connect_platform`), adapting
   to the current API. Keep T009's tests passing. Its spec's Done-when checks
   apply.
2. **Runner**: crate `connect/tests/connect_integration` (package
   `connect_integration`, a binary, not `#[test]`s, so the workspace test run
   never needs a live Connect), using `connect_client` and `clap`:
   `connect_integration --base-url <url> --customer-key <key>
   --redirect-origin <origin> [--follow-vendor]`. Each scenario prints
   `PASS`/`FAIL name: reason`; exit non-zero on any failure. Scenarios:
   - `health`; `catalog`: exactly the registry's live apps, every
     `icon_url` either null or serving an SVG.
   - `auth`: no key and a wrong key get 401.
   - `connections_empty`: a fresh random `external_user_id` has none;
     deleting a missing connection behaves as the API documents.
   - `client_metadata`: `/v1/oauth/client-metadata.json` is valid and its
     `client_id` and `redirect_uris` use `--base-url`.
   - `session_rules`: a redirect outside the customer's origins and an
     unknown app are rejected with the documented errors.
   - per live app, `authorize_<id>`: create a session, GET the `connect_url`
     without following, and assert a redirect to the vendor's authorization
     endpoint carrying `response_type=code`, PKCE S256 `code_challenge`,
     `state`, `redirect_uri=<base>/v1/oauth/callback`, and the expected
     `client_id` for the app's registration. With `--follow-vendor`, GET the
     vendor URL and assert it does not answer with an OAuth error (status
     and error parameters), which proves the vendor accepted Connect's client
     (needs a public HTTPS `--base-url`).
   - `gateway_unconnected`: the MCP gateway returns the documented
     not-connected error for a live app.
3. **Scripts**: `connect/tooling/integration.sh local` starts Compose, creates
   a customer with redirect origin `http://localhost:3000`, runs the runner,
   and stops Compose; `integration.sh dev` runs against
   `https://connect-dev.macro.com` with `--follow-vendor`, reading the
   customer key from `CONNECT_IT_CUSTOMER_KEY` (never printed).
4. **Docs**: `connect/tests/connect_integration/AGENTS.md` (+ symlink), and a
   "Verify" section in `bootstrap.md` pointing at `integration.sh dev`.

## Done when

- `connect/tooling/integration.sh local` passes (paste the PASS lines).
- `cargo nextest run --all-features -p connect_client -p connect_api -p connect_platform -p connect_registry`,
  clippy (`-D warnings`) for those plus `connect_integration`,
  `cargo x deps --check`, `just check` pass.

## Out of scope

Completing a real consent (needs test accounts and the browser; next task);
deploying; anything outside `connect/` except workspace membership and
generated Cargo artifacts.

## Result
