# search_freshness_probe

## What it is

Search freshness, end to end: once a minute per kind of round, the probe writes
a random word into an entity of its own user through the public gateway, then
searches for it as a client does, and records how long until search shows the
change (`search.freshness.probe_*`, the contract of
`infra/stacks/monitoring/monitors/search-freshness.ts`). A create, edit or
rename covers everything after the API acknowledges the write: publish, Kafka,
the indexer, the OpenSearch refresh, and the search route with its permission
checks. A delete covers only the search route: it hides a deleted entity
through its database check, whatever the index holds. No HTTP
API besides `GET /health`.

## How it works

- `domain/probe.rs`: one loop per rotation, one `search.freshness_probe` span
  per round; a round that overruns the minute delays only its own rotation.
  Documents have two rotations, the cycle and the crowded prefix.
- `domain/watch.rs`: searches every 1 s for 60 s, then every 5 s to 300 s,
  until every check holds in one poll: the new token matches, the replaced one
  does not, a deleted entity matches nothing. Shown within 60 s is `seen`,
  later `late`, never `unseen`; a fixture type without its fixture is
  `fixture_missing`. Searches failing for 30 s in a row, or at the
  deadline, end the round `search_failed`, not a miss.
- `domain/rotation.rs`: the cycles. Documents edit, rename, purge, create;
  messages post, edit, delete (in a private channel of the probe's own);
  projects rename, trash and purge, create; a text property on a document of
  its own; an agent session and a call record are fixtures, renamed only.
  The crowded-prefix round (`LatePrefixWord`, operation `crowded_prefix`)
  writes a new document each round whose word sorts late under a prefix that
  starts hundreds of indexed words (`con` + `zz` + nonce) and searches the
  prefix alone: a prefix search that keeps only the first expansions of a
  shard, as `match_phrase_prefix`'s 256 did before #11475, never finds it.
  The search is narrowed to that document's id, so other documents sharing
  the prefix cannot push it off the page, and polls every 5 s
  (`Schedule::RECALL`): it is a recall check, and the query is expensive.
- `outbound/`: the routes, with the user API key in `x-macro-user-api-key`, and
  `POST /dss/search` restricted to one type the way the SDK restricts it.

## Config (Doppler project `search-freshness-probe`, `dev` and `prd`)

`PROBE_USER_API_KEY`: a user API key (`mak_...`) of the environment's
dedicated probe user. Required, no fallback. `ENVIRONMENT` picks the gateway
(`ApiGatewayUrl`); `OVERRIDE_API_GATEWAY_URL` points it elsewhere.

## Recipes

- Seed a call record once per probe user: one with a transcript (one without
  is never indexed), titled `Search probe`. Until one exists, call rounds are
  skipped as `fixture_missing`, which no monitor counts. The probe creates its agent session itself
  when search shows none, once per process; an idle session costs nothing.
- Run it against dev from a machine, with the key of a user no running probe
  acts as (see Gotchas): `ENVIRONMENT=dev PORT=<free port>
  PROBE_USER_API_KEY=... RUST_LOG=search_freshness_probe=debug cargo run -p
  search_freshness_probe`; each round logs `probe round finished`.

## Checks

- `cargo test -p search_freshness_probe` (no database needed; `SQLX_OFFLINE=true`)

## Gotchas

- The crowded prefix (`CROWDED_PREFIX` in `main.rs`) must start more than 256
  indexed words per shard of the documents index in every environment, or the
  round passes whatever search does. Check one with a word `<prefix>zz<nonce>`:
  a partial search for `<prefix>.` still builds a capped `match_phrase_prefix`
  (punctuation), so it misses the word on a crowded shard and finds it on a
  quiet one, while `<prefix>` finds it on both.

- Nothing the probe makes may be shared: the probe user may belong to a team.
  A new document or project starts with the team's default link share, so the
  probe turns it off right after creating one, and deletes one it cannot. Its
  channel is private with no other member, its property definition is
  user-scoped, sessions start unshared, and it never @mentions anyone.

- Never run two probes as one user at once: each renames the same fixtures, so
  each sees the other's title and counts a miss. The stack deploys with
  `minimumHealthyPercent: 0` for that reason.
- Every write must remove what it replaces for good, not leave it in the
  Trash: a trashed document stays in the index until it is purged, and the
  project purge route ignores a project not in the trash (it answers 200), so
  projects are trashed, then purged.
- Shutdown deletes the entities the process created. A crash, a kill past the
  stop timeout, or a create that commits after its request timed out leaves
  some behind, titled `Search probe <token>`: at most a document, a
  crowded-prefix document, a project, a property document, and the message
  channel with its message per crash.
- A failed write resets that type: a document, message or project is deleted
  and created again, a fixture looked up again, the property document and
  definition replaced.

## Related

- Runbook: `docs/runbooks/search-freshness.md` · Stack: `infra/stacks/search-freshness-probe`
