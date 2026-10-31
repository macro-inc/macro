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
