# T021: Every used DCR/CIMD app in the catalog, labelled by OAuth client type

Base: `eric/macro-connect-dashboard` (PR #9272). Branch for review:
`eric/macro-connect-catalog`.

## Goal

The catalog lists every app that Macro users connect through Pipedream today
(`pipedream_connections > 0` in `docs/research/vendor-auth.csv`) and whose
vendor MCP server registers our client itself (CIMD or DCR), once it passes
conformance. Every catalog listing carries a label for how Connect gets its
OAuth client: `managed_oauth_app` (we registered an app with the vendor:
`own_app`) or `dcr` (the server registers our client: `cimd` or `dcr`).

## Context

- Registry: `connect/registry/apps/*/app.toml`, `connect/crates/connect_registry`,
  rules in `connect/docs/catalog.md`, probing in `connect/docs/probing.md`.
- Catalog API in `connect_api`, wire types in `connect_client`, catalog cards
  in `connect_demo`.
- Live today: linear, notion, posthog, sentry.
- Pending entries already in the registry with Pipedream usage (by
  connections): trello, granola, todoist, calendly, clickup, jira, netlify,
  stripe, dropbox, airtable, apollo, cloudflare, attio, supabase, openphone
  (`quo`), webflow, coda, confluence, shopify, canva, datadog, fathom,
  pipedrive, intercom, klaviyo, square, monday, paypal, typeform.
- Used but not in the registry: exa, mailchimp, raindrop, vercel, highlevel,
  zendesk, apify (`catalog.md` says each needs a conformance pass).
- Grafana has zero Pipedream connections: leave it pending.
- CIMD needs Connect's public `client_id` URL, so CIMD acceptance can only be
  checked against dev (`https://connect-dev.macro.com`); the planner deploys
  and runs that. DCR acceptance can be checked from here.

## Do

1. **Label.** Add `oauth_client` to each catalog listing in the API, wire
   types, OpenAPI, and client: `"managed_oauth_app" | "dcr"`, derived from
   `client_registration` (`own_app` → `managed_oauth_app`; `cimd`, `dcr` →
   `dcr`; `api_key` apps are not OAuth and get no label: make the field
   optional or exclude them per the type you choose, and say which). The demo
   catalog card shows it as a small badge ("Managed OAuth app" / "DCR").
2. **Re-probe** every app listed above per `probing.md`, today's date in
   `probed`. Correct `mcp_url`, `client_registration`, `scopes`, and
   `description` (from the server's `tools/list` where it lists before
   sign-in). Add registry entries (with icons) for the seven missing apps when
   they qualify per `catalog.md`.
3. **Classify each app** in a new table in `connect/docs/catalog.md`
   ("Conformance, 2026-10-31"): app, connections, registration, result,
   notes. Results:
   - `candidate`: metadata and registration work; set `status = "live"`.
   - `tenant`: the MCP URL or authorization server depends on the user's
     tenant or subdomain (likely Shopify, Zendesk, maybe Datadog/HighLevel):
     leave pending and describe what Connect would need.
   - `blocked`: allowlist, admin approval, or paid gate (likely Vercel,
     Datadog preview): leave pending with the reason.
   - `broken`: anything else, with the exact error.
4. **Acceptance probe.** Extend the integration runner (or add a
   `connect_integration` subcommand) so that, for every live app, it creates
   a connect session, follows to the vendor's authorize URL, and reports per
   app: pass when the vendor serves a sign-in or consent page (2xx, or a
   redirect to its login), fail on `invalid_client`, `invalid_redirect_uri`,
   or 4xx/5xx, with the response excerpt. One app failing must not stop the
   others; print a table at the end. The existing `--follow-vendor` logic is
   the starting point. Run it locally for the DCR apps and record results.
5. **Tests** for the label mapping (API JSON, client, demo badge escaping)
   and the registry loading every new entry.
6. **Docs:** `catalog.md` (the label, the table, remove the stale "need a
   conformance pass first" line for any app you settled), registry and API
   `AGENTS.md`, `docs/plan.md` coverage counts if they change.

## Done when

- `cargo nextest run --all-features -p connect_registry -p connect_api -p connect_client -p connect_demo`,
  clippy (`-D warnings`) for those plus `connect_integration`,
  `cargo x deps --check`, `just check` pass.
- Every app listed in Context has a row in the conformance table.
- The local acceptance probe has run for the DCR candidates; its table is in
  the Result.

## Result

### Changed

- `connect/crates/connect_client/src/{wire,test}.rs`, `connect/services/connect_api/src/{main,test}.rs`, and `connect/services/connect_demo/src/{main,test}.rs`: added optional `oauth_client` (`managed_oauth_app` or `dcr`) to catalog JSON and OpenAPI, mapped it from registration type, and rendered the demo badge. API-key entries omit the field.
- `connect/crates/connect_registry/src/{embedded,test}.rs`, 33 existing `connect/registry/apps/*/app.toml` files, and new `apify`, `exa`, `highlevel`, `mailchimp`, and `zendesk` app directories with SVG icons: re-probed the used apps, corrected metadata and statuses, and loaded the new entries. There are 41 registry entries; 30 are live candidates covering 1,160 existing connections.
- `connect/tests/connect_integration/src/{main,test}.rs` and `connect/tooling/integration.sh`: added a per-app authorization-page acceptance table, local DCR mode, and an isolated Compose project option.
- `connect/docs/catalog.md` and `connect/docs/plan.md`: documented the label policy, all 40 conformance classifications, probe URLs, icon sources, and updated coverage.
- `connect/crates/connect_client/AGENTS.md`, `connect/crates/connect_registry/AGENTS.md`, `connect/services/connect_api/AGENTS.md`, `connect/services/connect_demo/AGENTS.md`, and `connect/tests/connect_integration/AGENTS.md`: updated local guidance for the changed behavior and checks.

### Checks

All Rust and repository commands ran inside `nix develop --command` with the worktree's `CONNECT_CARGO_TARGET_DIR` and `CONNECT_DATABASE_URL` exported as `CARGO_TARGET_DIR` and `DATABASE_URL`.

| Check | Outcome |
| --- | --- |
| `cargo nextest run --all-features -p connect_registry -p connect_api -p connect_client -p connect_demo` | Pass: 44 tests, 0 failed, 0 skipped. |
| `cargo clippy -p connect_registry -p connect_api -p connect_client -p connect_demo -p connect_integration --all-features --all-targets -- -D warnings` | Pass. |
| `cargo test -p connect_integration` | Pass: 2 tests. |
| `cargo x deps --check` | Pass. |
| `cargo fmt --all -- --check` | Pass. |
| `just check` | Pass: cargo fmt, ast-grep, PII scan, and PII scanner tests (12). The pinned ast-grep binary needed the Nix glibc loader in this environment. |
| `connect/tooling/integration.sh local-acceptance` and final `connect_integration --acceptance --dcr-only` rerun | Pass: 12 of 12 live DCR app authorization pages; final table below. |
| `connect/tooling/integration.sh local` | Pass: all 26 reported local scenarios. |
| Headless Chromium demo check | Pass: `/demo` rendered 30 DCR badges; screenshot inspected. |

### Local DCR acceptance

The final probe used a rebuilt local API with `CONNECT_PUBLIC_URL=https://connect-dev.macro.com` and the local HTTP transport. Each row reached the vendor authorization flow without completing sign-in.

| App | Result | Vendor response |
| --- | --- | --- |
| attio | PASS | 302 login redirect to `app.attio.com` |
| calendly | PASS | 302 login redirect to `calendly.com` |
| clickup | PASS | 200 HTML sign-in or consent page |
| fathom | PASS | 302 login redirect to `fathom.video` |
| highlevel | PASS | 302 login redirect to `marketplace.leadconnectorhq.com` |
| mailchimp | PASS | 200 HTML sign-in or consent page |
| netlify | PASS | 200 HTML sign-in or consent page |
| paypal | PASS | 302 login redirect to `www.paypal.com` |
| quo | PASS | 200 HTML sign-in or consent page |
| stripe | PASS | 302 login redirect to `dashboard.stripe.com` |
| supabase | PASS | 200 HTML sign-in or consent page |
| webflow | PASS | 200 HTML sign-in or consent page |

An earlier probe also reached Coda: Connect returned `502 Bad Gateway` with `{"error":"oauth_failed"}` during client registration, although direct DCR returned 201. Coda is classified `broken` and remains pending, so it is absent from the final live-app run.

### Open questions

- Why does Connect's Coda registration fail after the vendor accepts the same DCR request directly? This needs diagnosis before Coda can be live.
- CIMD client-ID acceptance and full sign-in, refresh, tools, and read-only call conformance await the dev deployment and vendor test accounts, as scoped in the task Context.

### Proposed commits

1. `feat(connect): label catalog OAuth clients`
   - Why: Catalog consumers need the registration model for each OAuth app.
   - What: Add the optional wire/OpenAPI label, API mapping, demo badge, and contract tests.
2. `feat(connect): classify used remote MCP apps`
   - Why: Used apps need dated evidence before appearing in the catalog.
   - What: Re-probe registry entries, add qualifying entries and icons, classify all used apps, and update coverage and guidance.
3. `test(connect): check vendor authorization pages`
   - Why: Metadata and DCR registration alone do not show whether an app reaches sign-in.
   - What: Add per-app acceptance reporting, local DCR mode, redirect checks, and integration guidance.
