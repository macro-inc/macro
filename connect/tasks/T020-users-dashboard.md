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

## Result

### Changed

- API: `connect/services/connect_api/src/{domain.rs,main.rs,outbound.rs,test.rs}`,
  `migrations/20261031170401_list_customer_connections.sql`, and `AGENTS.md`.
  Added customer-scoped connection, summary, and user routes. The user route
  pages by `MIN(created_at), external_user_id`, then returns every connection
  for each selected user in one SQL query. Filters select users with a matching
  connection without trimming their returned connections. Added OpenAPI,
  spans, a concurrent connection index, and template0 database tests.
- Client: `connect/crates/connect_client/src/{lib.rs,wire.rs,test.rs}` and
  `AGENTS.md`. Added shared wire types, `list_connections`,
  `connections_summary`, `list_users`, and all-pages helpers with HTTP tests.
- Demo: `connect/services/connect_demo/{Cargo.toml,AGENTS.md}` and
  `src/{main.rs,style.css,test.rs}`. Added the dashboard, complete user rows
  from `/v1/users`, filters, pagination, responsive styles, and handler tests.
- Integration: `connect/tests/connect_integration/src/main.rs` and `AGENTS.md`.
  Extended `connections_listing` to exercise both customer listing routes.
- Docs and generated artifacts: `connect/docs/plan.md`, this Result, and
  `Cargo.lock`. No other files outside `connect/` changed.

### Checks

| Check | Exact outcome |
| --- | --- |
| `cargo nextest run --all-features -p connect_api -p connect_client -p connect_demo` | Passed: 36 tests, 0 skipped. |
| `cargo clippy -p connect_api -p connect_client -p connect_demo -p connect_integration --all-features --all-targets -- -D warnings` | Passed with no warnings. |
| `cargo x deps --check` | Passed. |
| `just hakari` | Passed; generated dependency artifacts remained in sync. |
| `just check` | Passed, including format, ast-grep, PII scan, and scanner tests. |
| Local integration runner in a fresh Compose project | Passed: health, catalog, auth, empty connections, `connections_listing` including `/v1/users`, client metadata, session rules, four authorize checks, and unconnected gateway. `integration.sh local` first hit occupied port 8080, then an old migration checksum in its existing volume; the fresh project ran the same runner successfully. |
| Isolated Compose dashboard smoke test | Passed. One user with two directly seeded connections appeared in one row with both app badges. Tiles: `users=1`, `connections=2`, `needs_reauth=1`. Containers were stopped without removing the volume. |
| `git diff --check` | Passed. |
| SQLx query review | Passed: both listings have customer predicates, stable keyset orders, limits, bound filters, and select only expiry metadata from grants. The user route uses one SQL query per page. Summary queries are customer-scoped. `just prepare_db` was skipped because Connect uses runtime-checked queries by its settled decision in `connect/docs/decisions.md`. |
| Browser and Tempo trace checks | Not run: no browser tool or binary was available, and the isolated Compose stack did not configure an OTLP exporter. The HTTP dashboard response and integration routes were exercised locally. |
| Repository audit | Passed: the auditor found no remaining code or documentation issue. |

The smoke test created a local customer using `create-customer` and selected its
ID through its temporary key ID. The direct seed SQL was:

```sql
INSERT INTO connections (id, customer_id, external_user_id, app_id, status, scopes, created_at)
SELECT '019a0000-0000-7000-8000-000000000001'::uuid, customer_id, 'dashboard-user', 'notion',
       'active', ARRAY[]::text[], '2026-10-20T09:00:00Z'::timestamptz
FROM customer_api_keys WHERE id = :'key_id'::uuid
ON CONFLICT (id) DO NOTHING;
INSERT INTO connections (id, customer_id, external_user_id, app_id, status, scopes, created_at)
SELECT '019a0000-0000-7000-8000-000000000002'::uuid, customer_id, 'dashboard-user', 'linear',
       'needs_reauth', ARRAY[]::text[], '2026-10-30T09:00:00Z'::timestamptz
FROM customer_api_keys WHERE id = :'key_id'::uuid
ON CONFLICT (id) DO NOTHING;
```

### Open questions

None.

### Proposed commits

1. `feat(connect): list customer connections and summary counts`

   Why: Customers need to discover connections without knowing user IDs.

   What: Add scoped paginated connection and complete user routes, summary,
   client contracts, index, integration scenario, tests, and API documentation.

2. `feat(connect-demo): add customer dashboard`

   Why: The demo needs a view of customer connection activity.

   What: Render summary tiles, per-app counts, complete paginated user rows,
   filters, responsive styles, and handler tests.

## Review (planner)

Good work; the pagination question was the right catch. Decision: add a
user-keyed listing and build the dashboard on it. Keep `/v1/connections` and
the summary as they are.

1. **`GET /v1/users?limit=&cursor=&app_id=&status=`**: the customer's users,
   one item per `external_user_id`: `external_user_id`, `first_connected_at`
   (min `created_at`), and `connections` (every connection of that user, same
   fields as `/v1/connections` items, ordered by `app_id`). Ordered by
   `first_connected_at DESC, external_user_id DESC`, keyset-paginated with an
   opaque cursor; `limit` counts users (default 100, max 500). `app_id` and
   `status` select users having at least one matching connection, and those
   users still return all their connections. Same layering, OpenAPI, spans,
   and errors as the other routes; one query per page (aggregate in SQL,
   e.g. `json_agg` or two bounded queries), not N+1.
2. **Client**: `list_users(UsersQuery) -> UsersPage` plus an all-pages helper.
3. **Dashboard**: user rows come from `/v1/users`, so each row is complete;
   "more" follows its cursor. Remove the grouping-of-connection-pages logic.
4. **Tests**: users never split across pages (a user with connections created
   far apart in time stays whole), ordering, filters keep all of a matching
   user's connections, customer isolation, bad cursor. Extend
   `connections_listing` (or add `users_listing`) in the integration runner.

Then finish and replace the Result with final outcomes, including the Compose
smoke with a user who has two connections.
