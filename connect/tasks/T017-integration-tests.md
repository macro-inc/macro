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

### Changed

- `connect/crates/connect_client/`: ported the public client, shared wire types, tests, and agent guide from T009. Its methods use host-root API routes and inject W3C trace context.
- `connect/crates/connect_platform/src/http.rs`, `src/http/test.rs`, `src/lib.rs`, and `AGENTS.md`: exported and verified outbound trace header injection.
- `connect/services/connect_api/Cargo.toml`, `src/main.rs`, `src/mcp.rs`, `src/domain.rs`, `src/domain/oauth.rs`, and `AGENTS.md`: use the shared customer-facing wire types at the HTTP boundary; domain models and policy remain in the service.
- `connect/tests/connect_integration/`: added the opt-in binary, its package manifest, agent guide, and `CLAUDE.md` symlink. `connect/tooling/integration.sh` runs local Compose or dev; `connect/docs/runbooks/bootstrap.md` documents verification.
- `Cargo.toml`, `Cargo.lock`, and `.github/workspace-dep-closures.json`: registered the crates and regenerated dependency artifacts.

### Checks

- `CONNECT_PORT=18080 connect/tooling/integration.sh local` inside `nix develop`: **passed**, exit 0. Port 8080 was occupied; the script used the documented port override. Output:

  ```text
  PASS health: ok
  PASS catalog: ok
  PASS auth: ok
  PASS connections_empty: ok
  PASS client_metadata: ok
  PASS session_rules: ok
  PASS authorize_linear: ok
  PASS authorize_notion: ok
  PASS authorize_posthog: ok
  PASS authorize_sentry: ok
  PASS gateway_unconnected: ok
  ```

- `cargo nextest run --all-features -p connect_client -p connect_api -p connect_platform -p connect_registry`: **passed**, 37/37 tests. This includes T009's client and API test requirement.
- `cargo clippy -p connect_client -p connect_api -p connect_platform -p connect_registry -p connect_integration --all-features --all-targets -- -D warnings`: **passed**, exit 0.
- `cargo x deps --check`: **passed**, exit 0 after artifact regeneration.
- `just check`: **passed**, exit 0; its PII scanner tests passed 12/12.
- `cargo test -p connect_integration`: **passed**, exit 0 with zero tests, confirming the live runner is opt-in.
- Audit: `cargo fmt --all -- --check`, `bash -n connect/tooling/integration.sh`, and `git diff --check` **passed**. The hexagonal boundary was checked: authorization and OAuth policy remain in the domain service; HTTP handlers map domain results into shared wire types.
- Dev `--follow-vendor` run and Tempo trace inspection were **not run**: no dev customer key or Tempo trace was available. The local run verified all four vendor redirect URLs without following them.

All Rust and repository checks ran inside `nix develop` with `CARGO_TARGET_DIR="$CONNECT_CARGO_TARGET_DIR"` and `DATABASE_URL="$CONNECT_DATABASE_URL"` exported. Nix warned that it could not install a pre-commit hook in the read-only `.git`; the checks still ran and passed.

### Open questions

None.

### Proposed commits

1. `feat(connect-client): expose typed customer API`

   Why: Customer calls need one typed client and a shared HTTP contract.

   What: Port the client and wire types, map API handlers to them, and propagate trace context.

2. `test(connect): verify live OAuth handshakes`

   Why: Live Connect behavior needs a repeatable check without completing vendor consent.

   What: Add the integration binary, local and dev scripts, verification guide, and this result.
