# Cache Record Selection Implementation Plan

## Proposed API

```ts
const selection = selectRecords(SoupItemFieldsFragmentDoc);

const page = await readRecords(cacheHost, selection, {
  cursor,
  limit: 500,
});
```

```ts
type SelectedRecordPage<T> = {
  records: T[];
  nextCursor: string | null;
};
```

`nextCursor` is present only when another complete matching record exists.

## Implementation plan

### 1. Remove the schema-specific entity index

- Delete `cache-core::entity_index` and its tests.
- Remove bucket, timestamp, search-text, scoring, counting, and snapshot APIs.
- Restore ordinary record persistence in:
  - `cache-idb`
  - `cache-sqlite`
  - `cache-wasm`
- Remove `queryIndexedItems` from WASM, Tauri, worker, host, and protocol layers.
- Remove projected SQLite columns and IndexedDB envelopes/indexes.
- Restore the unreleased feature-branch storage versions rather than supporting migration from them; normalized records are disposable.

### 2. Add generic fragment-based record selection

In `cache-core`:

- Extend document parsing to support named, fragment-only documents.
- Add a `record_selection` module containing:
  - Fragment validation.
  - Object/interface/union type-condition resolution.
  - Validation that selected concrete types are normalized entities.
  - Cursor and page models.
- Reject:
  - Unknown fragments or schema types.
  - Embedded/non-normalized type conditions.
  - Unbound variables in fragment fields.
  - Invalid or excessive page limits.

Add:

```rust
Engine::read_records(selection, cursor, limit)
```

The engine will:

1. Derive concrete type names from the fragment condition.
2. Iterate matching records in deterministic entity-key order.
3. Apply the fragment projection using normal denormalization.
4. Load linked cold records in batches.
5. Read the effective view, including optimistic layers.
6. Skip records that cannot satisfy the complete fragment.
7. Use one-record lookahead to decide whether to return `nextCursor`.

### 3. Add schema-neutral storage iteration

Replace the specialized index methods with one generic storage capability:

```rust
scan_records(type_names, after, limit)
```

Implement it for:

- `InMemoryStorage`
- SQLite, using ordered primary-key ranges
- IndexedDB, using object-store key cursors

No schema field names or application-level ordering metadata will be persisted.

### 4. Surface the API through every host

Add `readRecords` across:

- `cache-wasm`
- SharedWorker protocol and worker core
- Tauri commands/plugin
- `CacheHost`
- No-op host

Wire input contains only:

- Serialized fragment document
- Fragment name
- Opaque cursor
- Limit

Wire output contains only selected JSON records and `nextCursor`.

### 5. Add the typed frontend selection API

Create `exchange/record-selection.ts` with:

- `selectRecords(fragmentDocument)`
- `readRecords(host, selection, options)`
- Generated result-type inference
- Fragment-name extraction
- Defensive wire-result validation

Export it from `@graphql-cache/index`.

### 6. Replace index notifications

Replace `onEntityIndexChanged` with schema-neutral `onCacheChanged`.

Emit it for:

- Normal writes
- Optimistic writes and settlements
- External invalidations
- Queue refreshes that change the effective view
- Cache clears/resets

Record-selection consumers can invalidate and rerun without cache-core knowing their schema.

### 7. Adapt Quick Access

- Select cached `GraphqlSoupItem` records using the existing generated `SoupItemFieldsFragmentDoc`.
- Export/reuse the existing GraphQL Soup item mapper.
- Load record pages and map them into `QuickAccessItem`s.
- Perform bucket filtering, timestamp sorting, fuzzy search, counts, and visible-page slicing entirely in TypeScript.
- Make `loadMore` increase the locally visible slice after records have been loaded.
- Rename index-specific files, query keys, and flags to record-selection terminology.
- Remove indexed-snapshot mapping and tests.

### 8. Tests and verification

Add coverage for:

- Object and union fragment selection.
- Aliases and nested linked records.
- Cold storage reads.
- Optimistic records and updates.
- Incomplete-record omission.
- Stable, exclusive cursor pagination.
- `nextCursor` lookahead semantics.
- SQLite and IndexedDB parity.
- WASM, worker, Tauri, and no-op host transport.
- TypeScript result inference and malformed responses.
- Quick Access filtering, sorting, searching, counting, and pagination.

Verification:

```bash
cargo fmt
cargo test -p cache-core
cargo test -p cache-sqlite
cargo test -p graphql_cache_plugin
cargo check --target wasm32-unknown-unknown -p cache-idb -p cache-wasm --all-targets
wasm-pack test --headless --chrome crates/client/cache-idb
```

Then run focused web tests and `bun check` from `apps/web`.

Implementation will proceed incrementally: verify the generic Rust API first, then wire and consume it in Quick Access. After successful verification, create the required `jj` revision.

## Architecture check

Hexagonal boundaries were checked: these are client cache/transport adapters with no server-domain authorization or business-policy movement.
