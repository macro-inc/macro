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
| `migrate_agent_sessions.ts` | Repairs agent-session indexing for future events, without copying or backfilling data. |

All migration scripts default to `DRY_RUN=true`; pass `DRY_RUN=false` to apply.

## Repair agent-session indexing without historical data

Use `migrate_agent_sessions.ts` when `agent_sessions` was auto-created with
incorrect mappings and only future session events need to be searchable. It
uses the canonical schema in `create_indices.ts` to create `agent_sessions_v1`,
then atomically replaces the bare `agent_sessions` index with a write alias.
**Applying this deletes the bare index and its old search data.** Session data
in Postgres is untouched. No reindex, backfill, or event replay is performed.

From this directory, configure `OPENSEARCH_URL`, `OPENSEARCH_USERNAME`, and
`OPENSEARCH_PASSWORD` for the intended cluster (use a VPC connection/tunnel for
production), then run:

```sh
ENVIRONMENT=prod DRY_RUN=true bun scripts/migrate_agent_sessions.ts
ENVIRONMENT=prod DRY_RUN=false bun scripts/migrate_agent_sessions.ts
```

The preview prints the exact alias actions without changing anything. Apply
validates the destination mapping and primary-shard availability before the
atomic cutover, then checks the alias and mapping again. A correct existing
destination is reused; a completed migration is a no-op. Incompatible destination
mappings or unexpected alias targets cause a nonzero exit without a cutover.
The script touches only the agent-session index and alias.

The cutover has no gap where a writer can recreate the bare index. Events being
processed during the cutover may fail or leave an incomplete projection; this
script does not repair them. Once it completes, create a new session, complete a
turn, and verify its name and a unique phrase from each author's message appear
in search. Check search-processing logs for indexing errors. Historical sessions
may become searchable if a later lifecycle event reconciles them normally.

## Adding a field to an existing index

The index bodies in `create_indices.ts` are the source of truth for mappings.
Every body is `dynamic: 'false'`, so a field the service writes but the live
mapping lacks is dropped silently — and a search over it matches nothing
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
