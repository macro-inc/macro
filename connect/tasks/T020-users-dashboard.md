# T020: List a customer's users and connections, and a dashboard

Base: `eric/macro-connect-demo` (PR #9269). Branch for review:
`eric/macro-connect-dashboard`.

## Goal

A customer can see every user who has connected anything, and what each one
connected, without knowing user ids in advance: one paginated API listing and
one summary, exposed in `connect_client`, and a dashboard at
`https://connect-dev.macro.com/demo/dashboard` built on them. Everything is
scoped to the calling customer; no customer ever sees another's users.

## Context

- `connect/services/connect_api` (`list_connections`, `ConnectService::list`,
  `Repository`, `outbound.rs`, migrations, OpenAPI), `connect/crates/connect_client`
  (`wire.rs`, methods, tests), `connect/services/connect_demo` (page
  rendering, styles, tests).
- Today `GET /v1/users/{external_user_id}/connections` needs the user id.
- The dev stack is deployed by the planner; do not run `pulumi` against AWS.

## Do

1. **API** (hexagonal: handler maps wire types; customer scoping and limits
   live in the domain service; SQL in the outbound adapter):
   - `GET /v1/connections?limit=&cursor=&app_id=&status=`: the customer's
     connections, newest first (`created_at DESC, id DESC`), keyset-paginated
     with an opaque `next_cursor` (null on the last page). `limit` defaults to
     100, max 500; a bad cursor or filter is a documented 400. Each item:
     `external_user_id`, `app_id`, `status`, `scopes`, `created_at`,
     `updated_at`, `access_token_expires_at` (from `grants`, nullable). Never
     any grant material.
   - `GET /v1/connections/summary`: `users` (distinct external user ids),
     `connections`, `needs_reauth`, and `apps`: per app id `active` and
     `needs_reauth` counts.
   - Migration: index `connections (customer_id, created_at DESC, id DESC)`.
   - Both routes behind customer auth, in OpenAPI, spanned per the
     observability rule (customer id, counts; no user ids in span names).
2. **`connect_client`**: `list_connections(ConnectionsQuery) -> ConnectionsPage`
   and `connections_summary() -> ConnectionsSummary`, wire types shared with
   the API as today, plus a convenience stream or loop helper for all pages.
3. **Dashboard** in `connect_demo` at `GET /demo/dashboard`, linked from the
   `/demo` header (and `/demo` linked back):
   - Tiles: users, connections, needs re-auth.
   - Per-app table: icon, name, active, needs re-auth (every catalog app,
     zeros included).
   - Users table, one row per user: user id (shortened, full in `title`), a
     "you" marker for this browser's cookie user, each app as a status badge,
     first connected, earliest upcoming token expiry. Filters by app and
     status (query parameters, server-rendered). Up to 500 users with a
     "more" link that follows `next_cursor`.
   - Server-rendered, escaped, readable at 390 px (tables become stacked
     rows). Same styling as `/demo`.
4. **Tests**: API tests on `template0` databases covering customer isolation
   (two customers, neither sees the other), ordering and pagination across
   pages, filters, bad cursor, summary counts, and no grant fields in the
   JSON. Client tests for both methods. Demo handler tests for the dashboard
   (counts, "you" marker, escaping, filters, empty state).
5. **Integration**: a `connections_listing` scenario in
   `connect/tests/connect_integration` (fresh user appears with zero
   connections nowhere; summary responds; pagination params accepted).
6. **Docs**: API and demo `AGENTS.md`, `connect_client` `AGENTS.md`,
   `connect/docs/plan.md` if it lists the API surface.

## Done when

- `cargo nextest run --all-features -p connect_api -p connect_client -p connect_demo`,
  clippy (`-D warnings`) for those plus `connect_integration`,
  `cargo x deps --check`, `just check` pass.
- Compose run: after creating a customer and seeding two connections directly
  in the local database (document the SQL you used), `/demo/dashboard` shows
  them; paste the tile values.
- Nothing outside `connect/` changes except generated Cargo artifacts.

## Out of scope

Cross-customer operator views; user names or emails (Connect only knows
opaque ids); deploying; real vendor consent.
