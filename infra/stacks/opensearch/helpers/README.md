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
| `emails`       | `emails_v1`                |
| `call_records` | `call_records_v1`          |

The alias is the contract; the physical index is an implementation detail
that can be swapped without a code deploy.

### Helpers

| Script                       | Purpose                                                                |
| ---------------------------- | ---------------------------------------------------------------------- |
| `verify_aliases.ts`          | Pre/post-flight check: alias exists and points at the expected index.  |
| `add_alias.ts`               | Idempotent additive alias (no reindex). Use to dual-alias an index.    |
| `reindex_with_alias_swap.ts` | Reindex + atomic swap (handles `remove_index` for bare physical case). |
| `create_indices.ts`          | Idempotent first-time creation of every versioned index + alias.       |

All three migration scripts default to `DRY_RUN=true`; pass `DRY_RUN=false` to apply.

## Deploy ordering for this PR (read me first)

The Rust SearchIndex enum starts using alias names for every index when
this PR ships. Of the five aliases the new code references, four happen
to coincide with the existing physical index name in dev/prod
(`channels`, `chats`, `documents`, `call_records`), so OpenSearch
resolves the write correctly even before any alias is added — those
require **no** pre-merge action. The fifth, `emails`, does not exist
yet (the index lives at `emails_v2` under the legacy `emails_alias`),
so post-deploy email writes/reads would 404.

Required pre-merge step in each environment:

```sh
DRY_RUN=false bun scripts/add_alias.ts emails emails_v2
bun scripts/verify_aliases.ts   # emails entry should now show -> emails_v2
```

This is purely additive — old code keeps writing through `emails_alias`,
new code writes through `emails`, both resolve to `emails_v2`. Drop
`emails_alias` after the new code is fully rolled out.

The bare-physical → versioned migrations (`channels` → `channels_v1`,
etc.) and the `emails_v2` → `emails_v1` standardisation are independent
follow-up operations that can be scheduled per index using the playbook
below; they are not deploy-blocking for this PR.

## Migration playbook: bringing an existing environment to alias-based access

Each environment starts in a different state. Before deploying code that
relies on the new alias names, run the playbook for whichever index is
not yet behind the expected alias. The order minimises the write window
where new code could land before its alias is in place.

Pre-flight: see what's missing.

```sh
bun scripts/verify_aliases.ts
```

The output flags each alias that's missing, points at the wrong index,
or is currently a physical index (which needs a reindex). Three states
show up in practice:

1. **Bare physical index** (`channels`, `chats`, `documents`,
   `call_records` in pre-migration envs). The name is a physical index
   with no alias of the same name. Resolution: reindex + swap.
2. **Already aliased under a legacy name** (`emails_v2` aliased as
   `emails_alias`). The new code wants alias `emails`. Resolution: add
   the new alias name additively, then drop the legacy alias once the
   deploy is in.
3. **Mismatched physical index** (`emails` alias pointing at `emails_v2`
   when the canonical name is `emails_v1`). Resolution: reindex + swap.

### State 1: bare physical index → versioned index behind alias

```sh
# 1. Create the new empty versioned physical index. Idempotent.
#    create_indices.ts detects that the alias name (e.g. "channels") is
#    currently a bare physical index and creates the new versioned index
#    *without* attempting to add the alias — the alias has to be added
#    atomically with the deletion of the conflicting physical index, and
#    that's the swap script's job.
bun scripts/create_indices.ts

# 2. Dry run the swap. Confirm the actions list looks correct.
bun scripts/reindex_with_alias_swap.ts channels channels_v1

# 3. Apply. The script reindexes channels -> channels_v1, validates doc
#    counts, then issues an atomic _aliases call:
#      [{ remove_index: { index: "channels" } },
#       { add:          { index: "channels_v1", alias: "channels" } }]
DRY_RUN=false bun scripts/reindex_with_alias_swap.ts channels channels_v1

# 4. Replay writes that landed during the reindex window via the
#    search_processing_service backfill endpoints. Bound the window with
#    `since` set to just before step 3 started.

# 5. Re-run verify.
bun scripts/verify_aliases.ts
```

### State 2: legacy alias → add canonical alias additively, then drop legacy

For `emails_v2` aliased as `emails_alias`, the new code uses alias
`emails`. The safe order is:

```sh
# 1. Add the canonical alias on top of the existing physical index.
#    This is purely additive — emails_alias keeps working.
DRY_RUN=false bun scripts/add_alias.ts emails emails_v2

# 2. Verify both aliases now point at emails_v2.
bun scripts/verify_aliases.ts

# 3. Deploy the new application code. Old code still writes via
#    emails_alias; new code writes via emails. Both resolve to emails_v2.

# 4. Once the new code is fully rolled out and stable, drop the legacy
#    alias via the OpenSearch _aliases API:
#      POST /_aliases { "actions": [{ "remove": { "index": "emails_v2", "alias": "emails_alias" }}] }
```

### State 3: standardise emails_v2 onto emails_v1 (optional cleanup)

To bring the email physical index in line with the rest of the v1
naming, run the swap script after the alias is in place:

```sh
# Prereq: the canonical `emails` alias already points at emails_v2 (state 2).
# 1. Create emails_v1 with the same mapping. create_indices.ts notices
#    that the `emails` alias already points at emails_v2 (a different
#    index), so it creates emails_v1 *without* attempting to add the
#    alias. The swap in step 2 handles that atomically.
bun scripts/create_indices.ts

# 2. Dry run + apply.
bun scripts/reindex_with_alias_swap.ts emails emails_v1
DRY_RUN=false bun scripts/reindex_with_alias_swap.ts emails emails_v1

# 3. Replay writes from the reindex window via backfill.
# 4. Drop the old physical index.
bun scripts/delete_indices.ts emails_v2
```

### Avoiding downtime — write window strategy

The reindex script does `wait_for_completion=true` and then issues the
atomic alias swap. Writes that arrive *during* the reindex land on the
old index only and get cut off when the alias swaps. Two options:

- **Replay (default)**: accept the write window, then run a backfill
  bounded by `since=<reindex start time>` to replay anything that
  arrived during reindex onto the new index. Idempotent on `_id`, so
  re-running is safe.
- **Pause writers**: stop the producers (SQS consumers in
  search_processing_service) before the reindex, drain the queue, then
  reindex with no live writes. Lower risk, but causes a real pause in
  freshness rather than a backfill catch-up.

The reindex script refuses the swap when the destination has fewer docs
than the source, so it won't silently complete a half-finished migration.

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
