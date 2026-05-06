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

| Alias          | Underlying index (current) |
| -------------- | -------------------------- |
| `channels`     | `channels_v1`              |
| `chats`        | `chats_v1`                 |
| `documents`    | `documents_v1`             |
| `emails`       | `emails_v2`                |
| `call_records` | `call_records_v1`          |

The alias is the contract; the physical index is an implementation detail
that can be swapped without a code deploy.

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

3. **Pause writers** (or accept that writes during reindex go to the old
   index and need to be replayed). Backfill jobs are the most common
   replay path — see `search_processing_service` backfill endpoints.

4. **Apply the swap**:

   ```sh
   DRY_RUN=false bun scripts/reindex_with_alias_swap.ts documents documents_v2
   ```

   The script issues a single `_aliases` request that atomically removes
   the alias from the old index and adds it to the new one (or
   `remove_index` + `add` when the alias name was previously a physical
   index).

5. **Verify**: writes through the alias now land in `documents_v2`. Check
   doc counts continue to grow on the new index. Use the search API to
   confirm reads return expected results.

6. **Replay** any writes that landed during the reindex window via the
   backfill endpoints (filter by `since` to bound work).

7. **Drop the old index** once you're confident:

   ```sh
   bun scripts/delete_indices.ts "documents_v1"
   ```

### Promoting an existing physical index to live behind an alias

If an environment still has a raw physical index sharing the alias name
(e.g. an older `channels` index), the swap script handles this — it
detects the conflict and emits `remove_index` + `add` in the same atomic
actions list. Run the migration to a versioned name:

```sh
# 1. Create the new versioned index with the desired mapping (use create_indices.ts after bumping versions, or call the API directly).
# 2. Reindex + swap. The script will detect that "channels" is currently a physical index and handle removal atomically with the alias add.
DRY_RUN=false bun scripts/reindex_with_alias_swap.ts channels channels_v1
```

### Dry-run verification

Always run the script with `DRY_RUN=true` (the default) first. The output
shows the exact `_aliases` actions list that would be POSTed — eyeball
this before applying. Example output:

```
[DRY-RUN] Would run _aliases with actions:
{
  "actions": [
    { "remove_index": { "index": "documents" } },
    { "add": { "index": "documents_v1", "alias": "documents" } }
  ]
}
```
