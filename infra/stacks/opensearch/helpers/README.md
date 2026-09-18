# Opensearch Helpers

Helper scripts to manage OpenSearch indices.

## Setup

Create a `.env` file in this directory with:

```
OPENSEARCH_URL=
OPENSEARCH_USERNAME=
OPENSEARCH_PASSWORD=
```

Then run `bun scripts/${OPERATION}.ts` to perform an operation.

## Index aliasing

Application code (Rust) reads/writes via stable alias names defined in
`SearchIndex` / `OpenSearchEntityType::index_name()`:

| Alias          | Underlying index |
| -------------- | ---------------- |
| `channels`     | `channels_v1`    |
| `chats`        | `chats_v1`       |
| `documents`    | `documents_v1`   |
| `emails`       | `emails_v1`      |
| `call_records` | `call_records_v1`|

The alias is the contract; the physical index is an implementation detail
that can be swapped without a code deploy.

### Helpers

| Script                       | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `verify_aliases.ts`          | Pre/post-flight check: alias exists and points at the expected index.  |
| `verify_mappings.ts`         | Pre/post-flight check: live mappings carry every field the code declares. |
| `add_alias.ts`               | Idempotent additive alias (no reindex).                                |
| `reindex_with_alias_swap.ts` | Reindex + atomic swap (handles `remove_index` for bare physical case). |
| `create_indices.ts`          | Creates every versioned index + alias, and converges existing mappings. |

All migration scripts default to `DRY_RUN=true`; pass `DRY_RUN=false` to apply.

## Manual provisioning

Provision indices and aliases manually using the canonical declarations in
`create_indices.ts`, and verify them before deploying their consumers. Deployment
does not create or reconcile indices.

Normal agent-session parent and bulk writes set `require_alias=true`. A missing
alias fails the write instead of automatically creating a bare index with an
inferred mapping. Explicit backfill `index_override` requests may still target
a physical index. This guard does not provision a schema or recover events
already dropped by the consumer.

## One-time repair: incorrectly auto-created agent-session index

This is an operator procedure, separate from deployment. Confirm that
`agent_sessions` is a bare physical index with the incorrect mapping, not an
existing alias. If it is already an alias, inspect its target before proceeding.
Configure the intended cluster's usual `OPENSEARCH_*` credentials and use the
production VPC connection/tunnel when appropriate.

Create the versioned destination from the canonical declaration and verify it:

```sh
ENVIRONMENT=prod INDEX=agent_sessions bun scripts/create_indices.ts
ENVIRONMENT=prod INDEX=agent_sessions DRY_RUN=false bun scripts/create_indices.ts
ENVIRONMENT=prod INDEX=agent_sessions bun scripts/verify_mappings.ts
```

Inspect `GET /agent_sessions_v1/_mapping` against `AGENT_SESSIONS_V1_BODY` in
`create_indices.ts`: the existing verifier checks field presence and types,
not all mapping parameters. Confirm `dynamic:false`, the
`agent_session_relation` join from `agent_session` to `message`, field-alias
paths, and date formats before proceeding.

A bare index blocks alias creation, so creation deliberately leaves the alias
for this manual cutover. If the destination already contains data, inspect it
before deciding to use it. Wait for `agent_sessions_v1` health to be at least
yellow (all primary shards available), and recheck the source/alias state.

For a future-writes-only repair, submit this **single** request through the
OpenSearch API after explicitly accepting deletion of the old search projection:

```http
POST /_aliases
{
  "actions": [
    { "remove_index": { "index": "agent_sessions" } },
    { "add": { "index": "agent_sessions_v1", "alias": "agent_sessions", "is_write_index": true } }
  ]
}
```

Do not issue a separate DELETE followed by alias creation: a writer could
recreate the bare index between those operations. The atomic request deletes
the old index and its search data; Postgres session data is untouched. It does
not reindex or backfill. The generic `reindex_with_alias_swap.ts` helper copies
old documents, so it is not a substitute for this no-copy operation.

Require an acknowledged response, then run `verify_mappings.ts` with
`INDEX=agent_sessions`. Inspect `GET /_alias/agent_sessions`: its sole target
must be `agent_sessions_v1` and `is_write_index` must be true or omitted, never
false. Create a new session, complete a turn, and verify its title and unique
phrases from both authors are searchable.
Check indexing errors. In-flight reconciles can straddle the cutover; backfill
those sessions and any desired historical sessions using the existing
`POST /internal/backfill/agent-sessions` endpoint. Record the repair outcome in
the incident runbook.

## Adding a field to an existing index

The index bodies in `create_indices.ts` are the source of truth for mappings.
Every body is `dynamic: 'false'`, so a field the service writes but the live
mapping lacks remains in `_source` but is not indexed — and a search over it matches nothing
rather than erroring. That is how `call_records_v2` shipped without
`properties`/`name` and left tag filters on calls returning empty (macro-2731).

So the flow for a new field is:

1. Add it to the body in `create_indices.ts`.
2. Run `bun scripts/create_indices.ts` (dry-run) against each environment and
   read the plan, then `DRY_RUN=false` to apply. Existing indices keep their
   data and gain only the fields they're missing, via `_mapping` PUT.
3. Backfill the affected entity through `search_processing_service`
   (`POST /internal/backfill/<entity>`) so documents indexed before the
   mapping existed pick the field up.
4. Confirm with `bun scripts/verify_mappings.ts`.

Convergence is additive only. A field whose live `type` disagrees with the
body is reported, never rewritten — changing a live field's type needs the
reindex runbook below.

## Runbook: reindex with new mapping (zero downtime)

Use when you need to change a mapping that requires a full reindex (e.g.
field type change, analyzer change, breaking schema migration).

1. **Create the new physical index** at the next version. Either bump the
   version in `constants.ts` and run `bun scripts/create_indices.ts`, or
   create directly via the OpenSearch API. Example: `documents_v2`.

2. **Reindex + swap (dry run first)**:

   ```sh
   bun scripts/reindex_with_alias_swap.ts documents documents_v2
   ```

   This reads the current index behind the `documents` alias, reindexes
   into `documents_v2`, validates doc counts, and prints the `_aliases`
   actions it would apply. Nothing is changed.

3. **Apply the swap**:

   ```sh
   DRY_RUN=false bun scripts/reindex_with_alias_swap.ts documents documents_v2
   ```

   The script issues a single `_aliases` request that atomically removes
   the alias from the old index and adds it to the new one.

4. **Verify**: writes through the alias now land in `documents_v2`. Check
   doc counts continue to grow on the new index.

5. **Replay** any writes that landed during the reindex window via the
   `search_processing_service` backfill endpoints (filter by `since` to
   bound work).

6. **Drop the old index** once you're confident:

   ```sh
   bun scripts/delete_indices.ts documents_v1
   ```

### Write window strategy

The reindex script submits the reindex *async* (`wait_for_completion=false`)
with `slices=auto` (one sub-task per primary shard) and polls the OpenSearch
task API every `REINDEX_POLL_SECONDS` (default 10s) until it completes,
then issues the atomic alias swap. The async submission keeps a 60+ minute
reindex from being killed by the ALB / proxy idle timeout that a synchronous
request would hit.

Tunable env vars:

- `REINDEX_SLICES` — `auto` (default; matches the primary shard count) or a
  positive integer.
- `REINDEX_POLL_SECONDS` — poll cadence in seconds (default 10).

Ctrl-C during polling sends a `tasks.cancel` for the running reindex so it
doesn't keep running orphaned in the cluster.

Writes that arrive *during* the reindex land on the old index only and get
cut off when the alias swaps. Two options:

- **Replay (default)**: accept the write window, then run a backfill
  bounded by `since=<reindex start time>` to replay anything that
  arrived during reindex onto the new index. Idempotent on `_id`, so
  re-running is safe.
- **Pause writers**: stop the producers (SQS consumers in
  `search_processing_service`) before the reindex, drain the queue, then
  reindex with no live writes. Lower risk, but causes a real pause in
  freshness rather than a backfill catch-up.

The reindex script refuses the swap when the destination has fewer docs
than the source, so it won't silently complete a half-finished migration.

### Dry-run verification

Always run the script with `DRY_RUN=true` (the default) first. The output
shows the exact `_aliases` actions list that would be POSTed — eyeball
this before applying. Example output:

```
[DRY-RUN] Would run _aliases with actions:
{
  "actions": [
    { "remove": { "index": "documents_v1", "alias": "documents" } },
    { "add":    { "index": "documents_v2", "alias": "documents" } }
  ]
}
```
