# search_freshness_probe

## What it is

Search freshness, end to end: once a minute per entity type, the probe writes a
random word into an entity of its own user through the public gateway, then
searches for it as a client does, and records how long until search shows the
change (`search.freshness.probe_*`, the contract of
`infra/stacks/monitoring/monitors/search-freshness.ts`). It covers everything
after the API acknowledges the write: publish, Kafka, the indexer, the
OpenSearch refresh, and the search route with its permission checks. No HTTP
API besides `GET /health`.

## How it works

- `domain/probe.rs`: one loop per type, one `search.freshness_probe` span per
  round; a round that overruns the minute delays only its own type.
- `domain/watch.rs`: searches every 1 s for 60 s, then every 5 s to 300 s,
  until every check holds in one poll: the new token matches, the replaced one
  does not, a deleted entity matches nothing. A round whose last search failed
  is `search_failed`, not a miss.
- `domain/rotation.rs`: the cycles. Documents edit, rename, purge, create;
  messages post, edit, delete (in a private channel of the probe's own);
  projects rename, trash and purge, create; a text property on a document of
  its own; an agent session and a call record are fixtures, renamed only.
- `outbound/`: the routes, with the user API key in `x-macro-user-api-key`, and
  `POST /dss/search` restricted to one type the way the SDK restricts it.

## Config (Doppler project `search-freshness-probe`, `dev` and `prd`)

`PROBE_USER_API_KEY`: a user API key (`mak_...`) of the probe user in that
environment. Required, no fallback. Dev runs as a test account until a
dedicated one exists. `ENVIRONMENT` picks the gateway (`ApiGatewayUrl`);
`OVERRIDE_API_GATEWAY_URL` points it elsewhere.

## Recipes

- Seed the fixtures once per probe user: an agent session, and a call record
  with a transcript (one without is never indexed), each titled `Search probe`.
  Until one exists, that type's rounds are `write_failed` (`NoFixture`).
- Run it against dev from a machine: `ENVIRONMENT=dev PORT=<free port>
  PROBE_USER_API_KEY=... RUST_LOG=search_freshness_probe=debug cargo run -p
  search_freshness_probe`; each round logs `probe round finished`.

## Checks

- `cargo test -p search_freshness_probe` (no database needed; `SQLX_OFFLINE=true`)

## Gotchas

- Never run two probes as one user at once: each renames the same fixtures, so
  each sees the other's title and counts a miss. The stack deploys with
  `minimumHealthyPercent: 0` for that reason.
- Every write must remove what it replaces from search for good: a trashed
  document stays searchable, and the project purge route ignores a project not
  in the trash (it answers 200), so projects are trashed, then purged.
- Shutdown deletes the entities the process created; a crash leaves at most one
  per type, titled `Search probe`.

## Related

- Runbook: `docs/runbooks/search-freshness.md` · Stack: `infra/stacks/search-freshness-probe`
