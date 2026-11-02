# T006: OAuth connect flow and token refresh

Depends on T005. Base on the integration branch after T005 merges.

## Goal

A customer's user can connect any `live` catalog app: the customer creates a
connect session, the user's browser follows Connect's URL to the vendor's
consent screen, and Connect stores the grant and sends the user back. Tokens
refresh themselves when exported.

## Context

- `connect/docs/catalog.md` (`client_registration`: `cimd`, `dcr`, `own_app`).
- Prior art that already does all three registrations against real vendors:
  Macro's `crates/mcp_client/src/outbound/oauth.rs` (uses `rmcp`'s
  `AuthorizationManager`; `rmcp` is third-party and allowed). Mine it,
  including its notes on trailing slashes and Linear's scopes.
- Slack's user scopes: `crates/mcp_client/src/domain/provider_registry/slack/manifest.json`.
- T005's tables, `GrantCipher`, and customer auth.
- `.agents/rules/observability.md`: one trace from session creation through
  callback.

## Do

1. **Config.** `CONNECT_PUBLIC_URL` (Connect's own origin, e.g.
   `http://localhost:8080` locally). Own-app credentials as
   `<APP_ID>_CLIENT_ID` / `<APP_ID>_CLIENT_SECRET` for every `own_app` app,
   required at startup.
2. **Registry.** Allow `own_app` apps to list scopes (drop T002's rule);
   copy Slack's user scopes from the manifest into `slack/app.toml`.
3. **Migrations.** `customers.allowed_redirect_origins text[]`;
   `oauth_states` (state, PKCE verifier sealed with `GrantCipher`, customer,
   external user, app, redirect URL, client id, expires at 10 minutes,
   single use); `oauth_clients` (authorization-server issuer + redirect URI →
   DCR client id and sealed secret) so DCR registers once per server.
4. **Endpoints.**
   - `POST /v1/connect-sessions` (customer auth): `external_user_id`,
     `app_id`, `redirect_url` (origin must be in the customer's allowlist) →
     `connect_url`, `expires_at`.
   - `GET /v1/connect/{token}` (no auth, user's browser): discover the
     server's OAuth metadata, resolve the client (CIMD with client id
     `<CONNECT_PUBLIC_URL>/v1/oauth/client-metadata.json`, else DCR via
     `oauth_clients`, else own app), store the state, redirect to the vendor.
   - `GET /v1/oauth/client-metadata.json`: Connect's CIMD document.
   - `GET /v1/oauth/callback`: exchange the code, seal the grant, upsert the
     connection as `active`, redirect to the customer's `redirect_url` with
     `status=connected&app_id=...`, or `status=error&reason=...` (vendor
     error, expired or reused state, exchange failure).
5. **Refresh.** One refresh path used by token export (replace T005's 409):
   refresh when expiring within 60 s; serialize per connection (row lock) so
   concurrent exports refresh once; `invalid_grant` marks the connection
   `needs_reauth`.
6. **Observability.** Spans `connect.session.create`, `connect.authorize`,
   `connect.callback`, `connect.token.refresh` with `app_id`, registration
   kind, outcome; the callback span links to the authorize span through the
   stored state.
7. **Tests.** A `wiremock` authorization server and protected resource for
   each registration kind (CIMD, DCR with client reuse, own app); state expiry
   and reuse; redirect allowlist; vendor error passthrough; refresh success,
   `invalid_grant`, and two concurrent exports refreshing once.

## Done when

- `cargo nextest run --all-features -p connect_api -p connect_registry`
  passes.
- clippy (`-D warnings`), `cargo x deps --check`, `just check` pass.
- Result: a real local connection to Linear (CIMD) and Notion (DCR) through
  `localhost`, if their servers accept a `localhost` redirect; otherwise say
  which refused and why.

## Out of scope

The MCP gateway, Macro's adapter, the hosted connect UI beyond redirects,
deploys.

## Review (planner, 2026-10-30)

Answer to the builder's question: operators provision redirect origins from
the CLI; there is no HTTP endpoint for it in v1.

- `create-customer <name> --redirect-origin <origin>` (repeatable, at least
  one) stores them at creation.
- `set-redirect-origins <customer_id> <origin>...` replaces the list.
- Origins are validated as `scheme://host[:port]` with no path; `https` only,
  except `http://localhost` and `http://127.0.0.1` with any port.
- Session creation compares the redirect URL's origin exactly.

Proceed with the rest of the spec unchanged.

## Result

### Changed

- `connect/crates/connect_registry/src/{lib,test}.rs`, `connect/registry/apps/{slack,notion}/app.toml`, `connect/crates/connect_registry/AGENTS.md`, and `connect/docs/catalog.md`: allow own-app scopes, copy Slack's user scopes, and select DCR for Notion as the spec's conformance case.
- `connect/services/connect_api/migrations/20261030181717_oauth_flow.sql`: customer redirect allowlists, short-lived sessions and single-use sealed PKCE states, reusable sealed DCR clients, and connection refresh metadata.
- `connect/services/connect_api/src/{main,domain,outbound,oauth_test,test}.rs`, `src/domain/oauth.rs`, `src/outbound/{oauth,oauth_store}.rs`, `connect/services/connect_api/{Cargo.toml,AGENTS.md}`, and `Cargo.lock`: CLI redirect-origin provisioning, HTTP OAuth flow and client metadata, KMS-backed state/client/grant storage, row-locked token refresh, trace correlation, and wiremock integration tests.

### Checks

- `nix develop --command ... just hakari`: passed.
- `nix develop --command ... cargo nextest run --all-features -p connect_api -p connect_registry`: passed, 18/18 tests, including exported-token protected-resource requests for CIMD, DCR, and own-app.
- `nix develop --command ... cargo clippy -p connect_api -p connect_registry --all-features --all-targets -- -D warnings`: passed. Earlier runs found unused code and an unnecessary exchange argument; both were fixed.
- `nix develop --command ... cargo x deps --check`: passed.
- `nix develop --command ... just check`: passed after formatting (earlier run failed on formatting and was fixed).
- `nix develop --command ... cargo fmt --all --check`: passed.
- `git diff --check HEAD`: passed.
- Local conformance: Linear's live authorize endpoint returned HTTP 400 `Invalid client_id` for `http://localhost:8080/v1/oauth/client-metadata.json`. Notion's live metadata advertises DCR, but no grant was completed; live DCR registration and user consent would touch the vendor's production service and require a signed-in test account. No live credentials or secrets were read.
- Browser and Tempo trace verification: not run; no browser or local Tempo session is available in this builder environment.

### Open questions

- Which HTTPS public URL or tunnel should the planner use for local Linear CIMD conformance? The localhost HTTP client-metadata URL is rejected by Linear.
- Where may a builder perform Notion DCR registration and user consent under the brief's prohibition on touching production? A vendor sandbox or explicit follow-up conformance run is needed to verify the real grant.
- The planner must provision `CONNECT_PUBLIC_URL` and the GitHub/Slack own-app credentials in Connect's runtime configuration before deployment; this builder did not touch Doppler or production.

### Proposed commits

1. `feat(connect-registry): allow own-app scopes and select Notion DCR`

   Why: Slack's existing OAuth app grants explicit user scopes, and T006 uses Notion as the DCR conformance case.

   What: Remove the own-app scope ban, record Slack's manifest scopes, classify Notion as DCR, and update catalog guidance.

2. `feat(connect-api): add OAuth connect flow and refresh`

   Why: Customers need vendor consent, encrypted grants, and fresh tokens before Connect can replace Pipedream connections.

   What: Add redirect allowlists, connect sessions, CIMD/DCR/own-app authorization, callbacks, sealed state and clients, serialized refresh, tracing, and integration tests.
