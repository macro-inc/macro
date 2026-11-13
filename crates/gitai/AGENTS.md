# gitai

## What it is

The domain of gitai-service, Macro's server for the open-source git-ai client:
ingest of metrics, notes and transcripts from git-ai daemons, and the read API
agents use for attribution. `services/gitai_service` wires it up.

## Start here

- `src/inbound/http.rs`: the router; `/worker/*` routes sit under the 64 MB
  body limit. Handlers in `http/worker.rs` and `http/credentials.rs`.
- `src/domain/service.rs`: the use cases; each authenticates its caller.
- `src/domain/ingest.rs`: one metrics upload → filter, redaction, records.
- `src/domain/ports.rs`: `ObjectStore` (S3), `IndexStore` (DynamoDB),
  `IngestMetrics` (OTLP counters).
- `src/domain/wire.rs`: the sparse metrics format and its positions.
- `src/domain/redaction.rs`, `repository.rs`, `note.rs`: the redaction rules,
  the repository allowlist check, and the sessions named in a note.
- `src/domain/models.rs`: allowlist, pinned release, credential types.

## Scope

- Owns: the git-ai wire contract, redaction, repository filtering, device
  credentials, the S3 layout and the DynamoDB key design.
- Not here: config and startup → `services/gitai_service`; AWS resources →
  `infra/stacks/gitai-service`.

## Auth

- `X-API-Key` carries both kinds of key. The shared key (`GITAI_SHARED_KEY`,
  constant-time compare) opens only `/v1/credentials`; a device credential
  (`gitai_` + 32 random bytes base64url) opens every other route except the
  release download redirect, which the client calls without a key.
- Credentials are stored as SHA-256 only; unknown or revoked → 401.
  `last_used_at` is rewritten at most every 5 minutes.
- Identity on stored data is the credential's email and hostname;
  `X-Author-Identity` is never read.

## Ingest rules

- Every event type, and every note, must belong to an allowed repository
  (attribute 1 normalized to `host/owner/name`). Others are dropped silently
  and counted, never listed in `errors` (so the client stops retrying).
- `errors` lists only malformed events. Never answer 429/503: the client backs
  off 5 minutes to 12 hours and ignores `Retry-After`. 500 only for storage
  failures (the client retries).
- Every string of a kept event is redacted before any write or log.
- Retries are safe: transcript chunk ids are content hashes, token buckets keep
  the highest `emitted_seq`, commits count in metrics only when new.
- Notes uploads are stored only for commits already indexed (a note carries no
  repository). CAS uploads are acknowledged and discarded (no repository, no
  producer in 1.7.7).

## Session ids

- The id the service keys and exposes is git-ai's session id, attribute 24:
  `s_` + the first 14 hex of SHA-256(`<tool>:<external id>`)
  (`ingest::git_ai_session_id`). Authorship notes use the same id (`sessions`
  keys and `s_…::t_…` line attestations), so commits join to sessions directly.
- Attribute 23 is the agent's own id (Claude Code session UUID, Codex rollout
  id), kept as `external_session_id` and indexed in `gsi1`. An event without
  attribute 24 gets it derived from attributes 20 and 23.
- Older notes key a `prompts` map by a 16-hex prompt hash instead; those keys
  appear as session ids on the commit.

## Storage

Events bucket (versioned, kept; IA after 90 days):

| Key | Holds |
| --- | --- |
| `raw/v=1/dt=<date>/hour=<hh>/<uuidv7>.jsonl.zst` | Kept non-transcript events, one line each: `{"envelope", "event"}` |
| `notes/<aa>/<sha>` | Latest note text (redacted) |
| `commits/repo=<owner>__<name>/dt=<date>/<uuidv7>.jsonl.zst` | One `CommitRecord` row per commit |
| `usage/dt=<date>/<uuidv7>.jsonl.zst` | One `TokenBucket` row per bucket revision |

Sessions bucket (unversioned; expires after 180 days):

| Key | Holds |
| --- | --- |
| `sessions/tool=<tool>/sid=<session id>/<first ts, 10 digits>-<chunk id>.jsonl.zst` | One batch's lines of one session, oldest first; each `{"envelope", "event"}`, the transcript line is `event.v["0"]` |
| `session-index/dt=<date>/<uuidv7>.jsonl` | One line per chunk written |

`envelope` = `{received_at, credential_id, email, hostname, distinct_id,
client_version}`. Dates are the server's receive time (UTC).

Table (string `pk`/`sk`, GSI `gsi1` on `gsi1pk`/`gsi1sk`, TTL on
`expires_at`):

| Item | `pk` | `sk` | `gsi1pk` / `gsi1sk` | Attributes |
| --- | --- | --- | --- | --- |
| Credential | `CREDENTIAL#<sha256>` | `CREDENTIAL` | `CREDENTIALS` / `<id>` | `id`, `email`, `hostname`, `created_at`, `last_used_at`, `revoked_at` |
| Commit | `COMMIT#<sha>` | `COMMIT` | | `CommitRecord` fields (no note text), `session_ids` |
| Session | `SESSION#<id>` | `SESSION` | `EXTERNAL_SESSION#<agent id>` / `SESSION#<id>` | `tool`, `model`, `repository`, `author`, `hostname`, `transcript_prefix`, `first_seen`, `last_seen`, `event_count`, `*_tokens`, `cost_micro_usd`, `commit_shas` (SS) |
| Transcript chunk | `SESSION#<id>` | `CHUNK#<first ts>#<chunk id>` | | `s3_key`, `event_count`, `first_ts`, `last_ts` |
| Token bucket | `SESSION#<id>` | `TOKENS#<model>#<speed>#<bucket ts>` | | `TokenBucket` fields |

Page a transcript with a `Query` on `begins_with(sk, "CHUNK#")`: chunks come
back in time order. Counter attributes are absent while zero.

## Recipes

- Add a client route: handler in `inbound/` → use case on `GitaiService` →
  port method in `domain/ports.rs` → adapter in `outbound/`. Register `/worker`
  routes in `worker_routes`, before the body limit layer.
- Add a redaction rule: a `RedactionRule` variant, a pattern in `PATTERNS`
  (before the generic Bearer/assignment rules if it is a token shape), and a
  masked plus near-miss test. Build secret-shaped test values with `concat!`
  so the repository's secret scanner accepts the file.

## Checks

- `cargo nextest run --all-features -p gitai -p gitai_service`
- Contract tests decode every fixture in `tests/fixtures/client-1.7.7`.

## Gotchas

- S3 is the source of truth; the table is an index that can be rebuilt from it.
  S3 objects are written before index items.
- Never log or put on spans transcript text, note content, subjects, keys or
  emails; metrics carry only the METRICS labels.
- Store unknown metric event ids and attribute positions untouched, so newer
  clients keep working.
- TokenUsage buckets are re-sent with a higher `emitted_seq` when they change;
  summing events double counts.

## Related

- Skills: `cloud-storage-hexagonal-architecture`, `instrumentation`
