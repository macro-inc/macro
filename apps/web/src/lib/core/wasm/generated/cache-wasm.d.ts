/* tslint:disable */
/* eslint-disable */

export class CacheEngine {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Returns the opaque identity bound to this cache, or `null` when no
     * identity-bearing response has been stored yet.
     */
    boundIdentity(): Promise<any>;
    /**
     * Atomically applies fetched coverage, delta deletions, and sync state.
     * Resolves like `writeQuery` so hosts fan out the deleted records.
     */
    calendarCommit(commit: any): Promise<any>;
    /**
     * Answers a calendar viewport from cached occurrences, reporting the
     * spans that were never fetched and the applied change watermark.
     */
    calendarRange(request: any): Promise<any>;
    /**
     * Copies the WAL into the database file once it holds 500 frames or more.
     * The worker calls it between requests, when its queue is empty, so a
     * COMMIT rarely reaches the 1,000 frames at which Turso copies inside it.
     * Resolves to `{ran, walFrames, backfilledFrames}`. A failed copy rejects
     * and leaves the WAL whole for the next call to retry; like any storage
     * call, only an error that means corruption latches a reset.
     */
    checkpointIfDue(): Promise<any>;
    /**
     * Claims the oldest runnable queued mutation.
     */
    claimNextMutation(owner: string, now_ms: number, lease_expires_at_ms: number): Promise<any>;
    /**
     * Drops all cached state, including the durable mutation queue.
     */
    clear(): Promise<any>;
    /**
     * Consumes the engine, closes Turso and all OPFS handles, then preserves a
     * healthy database or resets a latched-unhealthy database before releasing
     * the exclusive owner lock. Every later instance method rejects.
     */
    close(): Promise<any>;
    /**
     * Writes the hydrate `prepareHydrate` kept and resolves like
     * `hydrateQuery` issued now. When storage may have changed since the
     * prepare, it reads the projections again first and the result says
     * `projectionsReread`.
     */
    commitHydrate(): Promise<any>;
    /**
     * Atomically replaces a claimed optimistic layer with the real network
     * response and removes it from the durable queue.
     */
    commitOptimisticWrite(transaction_id: string, lease_owner: string, lease_generation: string, query: string, operation_name: string | null | undefined, variables: any, data: any, generation?: string | null): Promise<any>;
    /**
     * Commit only exact absence evidence, invalidating older contact writes.
     */
    contactReconcile(request: any): Promise<any>;
    /**
     * Capture contact admission and optionally one bounded normalized-ID page.
     */
    contactSnapshot(request: any): Promise<any>;
    /**
     * Capture before requesting permission or response content.
     */
    currentAuthority(identity: string): Promise<any>;
    /**
     * Returns the current in-memory cache revision as an unsigned decimal string.
     */
    currentRevision(): Promise<any>;
    /**
     * Returns the durable cache generation, initializing it when absent.
     */
    currentStorageGeneration(): Promise<any>;
    /**
     * Retains a retryable mutation and releases its queue lease.
     */
    deferOptimisticWrite(transaction_id: string, lease_owner: string, lease_generation: string, next_attempt_at_ms: number, error: string, server_failure: boolean): Promise<any>;
    /**
     * Deletes stale records from memory and Turso after a server-side
     * mutation and resolves to affected local operation ids.
     */
    deleteKeys(keys: string[]): Promise<any>;
    /**
     * Durably queues a mutation and its optimistic response, then attempts
     * to claim the strict queue head before resolving. Claim failures are
     * returned as a nested diagnostic outcome because enqueue succeeded.
     */
    enqueueOptimisticMutation(origin_op_id: string | null | undefined, uuid: string, query: string, operation_name: string | null | undefined, variables: any, data: any, link_patches: any, revalidations: any, identity_bindings: any, created_at_ms: number, lease_owner: string, now_ms: number, lease_expires_at_ms: number, client_metadata: any, uncertain_calendar_event_keys: any, generation?: string | null): Promise<any>;
    /**
     * Evaluates one exact current-profile GraphQL Soup filter request.
     */
    entityFilter(request: any): Promise<any>;
    /**
     * Reacts to a cache reset performed by another engine instance sharing
     * the same storage (cross-tab broadcast). Drops local in-memory state
     * and resolves to every local operation id (all must re-execute).
     */
    externalReset(): Promise<any>;
    /**
     * Normalizes and stores a query response while returning only fields not
     * marked `@cacheOnly` in the GraphQL document.
     */
    hydrateQuery(query: string, operation_name: string | null | undefined, variables: any, data: any, identity: string | null | undefined, hydration_scope: any): Promise<any>;
    /**
     * Inspects durable mutations without claiming them.
     */
    inspectMutations(): Promise<any>;
    /**
     * Enumerates and materializes cached variants of one generated query field.
     */
    inspectQuery(query: string, operation_name: string | null | undefined, path: any, variable_filters: any): Promise<any>;
    /**
     * Recovers cached query variables without materializing each variant.
     */
    inspectQueryVariants(query: string, operation_name: string | null | undefined, path: any): Promise<any>;
    /**
     * Evicts externally-changed records from the hot tier (cross-tab
     * broadcasts, push invalidation). Resolves to the affected local
     * operation ids.
     */
    invalidateKeys(keys: string[]): Promise<any>;
    /**
     * Inspect publication without scanning contacts.
     */
    peopleContext(scope: any): Promise<any>;
    /**
     * Execute a read in the local Turso database under the account/generation lock.
     */
    peopleReadSql(request: any): Promise<any>;
    /**
     * Resolve bounded label evidence without exposing the cached directory.
     */
    peopleResolveReferences(request: any): Promise<any>;
    /**
     * Return only bounded winners after context-aware exclusions and ranking.
     */
    peopleSearch(request: any): Promise<any>;
    /**
     * Publish bounded local facts without changing account or public membership.
     */
    peopleUpdate(update: any): Promise<any>;
    /**
     * Physically resets and recreates this instance's OPFS database while
     * retaining the exclusive owner lock. The instance remains usable after
     * the fresh engine has been installed.
     */
    physicalReset(): Promise<any>;
    /**
     * The first half of `hydrateQuery`: converts the response and reads the
     * projection rows it sets itself, without writing. The engine keeps the
     * result for `stepHydrate`, `stageHydrate` and `commitHydrate`,
     * replacing any it kept before. Between them the host may run requests
     * that only read. Whatever runs between, the commit writes the response
     * as `hydrateQuery` would at that moment: after a write, a clear, a
     * reset or an authority transition it reads the projections again
     * first. A close drops the kept hydrate.
     */
    prepareHydrate(query: string, operation_name: string | null | undefined, variables: any, data: any, identity: string | null | undefined, hydration_scope: any): Promise<any>;
    /**
     * Returns payload-free durable mutation queue diagnostics.
     */
    queueDiagnostics(): Promise<any>;
    /**
     * Attempts a cache read. Resolves to `{kind:"hit",data}` or
     * `{kind:"miss"}`. When `opId` is given, the operation is registered
     * as active for dependency-driven re-execution.
     */
    readQuery(op_id: string | null | undefined, query: string, operation_name: string | null | undefined, variables: any, entity_resolvers: any): Promise<any>;
    /**
     * Projects explicit normalized entity keys through a named GraphQL
     * fragment without scanning storage.
     */
    readRecordsByKeys(document: string, fragment_name: string, keys: any): Promise<any>;
    /**
     * Reloads optimistic layers after another engine changes the durable
     * queue and returns locally affected operations.
     */
    refreshOptimisticQueue(): Promise<any>;
    /**
     * Permanently fails a claimed mutation and removes its optimistic
     * contribution.
     */
    rollbackOptimisticWrite(transaction_id: string, lease_owner: string, lease_generation: string): Promise<any>;
    /**
     * Searches the compact materialized projection. Empty queries use the
     * indexed recent path; text queries rank streamed compact matches without
     * scanning normalized record blobs.
     */
    search(request: any): Promise<any>;
    /**
     * Optional, between `prepareHydrate` and `commitHydrate`: reads what the
     * kept hydrate merges into and computes its write, without writing, so
     * the commit only writes. The host may run requests that only read
     * before and after it. A write since the prepare leaves nothing staged,
     * and a staged write the commit can't use (anything changed since) is
     * dropped: the commit then writes the hydrate whole, as it always did.
     * Rejects, keeping nothing to commit, when staging fails: the hydrate
     * fails with the error it would have met whole.
     */
    stageHydrate(): Promise<any>;
    /**
     * Optional, after `prepareHydrate`: runs the kept hydrate's next
     * projection pass, without writing, and resolves whether one ran. The
     * host may run requests that only read after each. It resolves false
     * once every pass ran, or once a write since the prepare means the
     * commit reads them again; `stageHydrate` and `commitHydrate` run any
     * passes left. Rejects, keeping nothing to commit, when a pass fails:
     * the hydrate fails with the error it would have met whole.
     */
    stepHydrate(): Promise<any>;
    /**
     * Unregisters an operation (urql teardown).
     */
    teardownOperation(op_id: string): Promise<any>;
    /**
     * Compare a fresh proof and retire its old snapshots while the owner is locked.
     */
    transitionAuthority(identity: string, expected: string, policy: string): Promise<any>;
    /**
     * Incrementally projects an ordinary query at one engine revision.
     */
    watchQuery(op_id: string, query: string, operation_name: string | null | undefined, variables: any, entity_resolvers: any, since?: string | null): Promise<any>;
    /**
     * Normalizes and stores a network response. Resolves to
     * `{changed: string[], affectedOps: string[], reset: boolean}` —
     * `affectedOps` are the registered operation ids (excluding
     * `originOpId`) whose data changed. `identity` is an opaque session tag
     * (extracted by the exchange from the response); a tag mismatching the
     * cache's bound identity wipes and rebinds atomically with this write.
     */
    writeQuery(context: any, query: string, operation_name: string | null | undefined, variables: any, data: any, identity?: string | null): Promise<any>;
}

/**
 * One statement in flight.
 */
export class Query {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Feed the bins (`[{key, count}]`) of the outstanding request.
     */
    feed_bins(request_id: number, bins: any): any;
    /**
     * Feed one page (`{rows, next}`) of the outstanding request.
     */
    feed_page(request_id: number, page: any): any;
    /**
     * Compile `sql` against `catalog` (a `Catalog` as JSON).
     *
     * # Errors
     *
     * Throws an `EngineError` when the catalog cannot be read or the
     * statement does not compile.
     */
    constructor(catalog: any, sql: string);
    /**
     * The first step. Taken once; a second call is an error.
     */
    start(): any;
}

/**
 * The `Board` a board view makes of `outcome`, what its `runView` query
 * produced, with the cards' stored `positions` (`CardPosition[]`).
 *
 * # Errors
 *
 * Throws an `EngineError` when an argument cannot be read, or the view is
 * not a board that fits its table.
 */
export function board(catalog: any, view: any, outcome: any, positions: any): any;

/**
 * The catalog a statement run from `scope` (a database id) names tables in,
 * built from `schema` (a `Schema` as JSON).
 *
 * # Errors
 *
 * Throws an `EngineError` when the schema or the scope cannot be read.
 */
export function buildCatalog(schema: any, scope?: string | null): any;

/**
 * Read-only metadata embedded in this WASM binary, available without opening storage.
 * Recovery fixtures compare both artifacts before invoking any destructive hook.
 */
export function cacheBuildInfo(): any;

/**
 * Physical database identity this build opens for `scope`; it also names the
 * OPFS files and derives the owner Web Lock name.
 */
export function cacheDatabaseIdentity(scope: string): string;

/**
 * Installs a schema other than the bundled one, once per worker, before
 * opening its engine. The app's own worker needs no call: engines use the
 * bundled schema, decoded from tables built with this binary.
 */
export function configureCacheSchema(schema_sdl: string): void;

/**
 * Compile read metadata without executing any source.
 *
 * # Errors
 * Throws an `EngineError` for invalid catalogs/statements or attempted writes.
 */
export function describeRead(catalog: any, sql: string): any;

/**
 * Describe a view's compiled read without fetching rows.
 *
 * # Errors
 * Throws an `EngineError` when the catalog or view cannot be read or compiled.
 */
export function describeView(catalog: any, view: any): any;

/**
 * Recovery-wipes and recreates the cache database for `scope` while holding
 * the same exclusive OPFS owner lock used by [`openCache`](open_cache).
 */
export function destroyCache(scope: string): Promise<void>;

/**
 * A position key that sorts after `before` and before `after`; leave one
 * out to place it first or last.
 *
 * # Errors
 *
 * Throws an `Error` when a bound is not a key or they are out of order.
 */
export function keyBetween(before?: string | null, after?: string | null): string;

/**
 * Opens (or creates) the cache for `scope` after acquiring its exclusive OPFS
 * owner lock. The physical identity is derived from `scope` alone; disposable
 * incomplete or incompatible files are reset and reopened before returning.
 */
export function openCache(scope: string, hot_capacity?: number | null): Promise<CacheEngine>;

/**
 * Acquires the canonical owner once, recovery-wipes before any Turso open,
 * then opens a fresh cache while continuously retaining that same owner lock.
 */
export function openCacheForRecovery(scope: string, hot_capacity?: number | null): Promise<CacheEngine>;

/**
 * Additive recovery-open API returning the engine and coarse wipe outcome.
 * `on_owner_lock_acquired` and `if_available` behave as in
 * [`openCacheWithOutcome`](open_cache_with_outcome); both precede the wipe.
 */
export function openCacheForRecoveryWithOutcome(scope: string, hot_capacity?: number | null, on_owner_lock_acquired?: Function | null, if_available?: boolean | null): Promise<any>;

/**
 * Additive open API returning the engine and payload-free recovery outcome.
 *
 * When given, `on_owner_lock_acquired` is called once the owner lock is held
 * and before any OPFS access; opening continues after its promise resolves.
 * A rejection releases the lock without touching storage.
 *
 * With `if_available`, opening never waits behind another holder of the
 * owner lock: it rejects at once, touching nothing, with an error whose
 * `cacheOwnerLockUnavailable` property is `true`.
 *
 * When another context keeps the database files open through the adapter's
 * bounded wait, opening rejects with an error whose `cacheStorageBusy`
 * property is `true`. A plain open has then changed neither file; a recovery
 * wipe may have removed one of them.
 */
export function openCacheWithOutcome(scope: string, hot_capacity?: number | null, on_owner_lock_acquired?: Function | null, if_available?: boolean | null): Promise<any>;

/**
 * What `text` reads as, a `FormulaReading`, typed as the formula of a
 * derived column of the table `table` (an id) in `catalog`; `own` is that
 * column's placement id once it exists, so the formula cannot read itself.
 *
 * # Errors
 *
 * Throws an `EngineError` when the catalog cannot be read or has no such
 * table.
 */
export function readFormula(catalog: any, table: string, own: string | null | undefined, text: string): any;

/**
 * Deletes one of this scope's databases that an older build left behind (see
 * [`cacheDatabaseIdentity`](cache_database_identity)), unless another context
 * holds its owner lock (`in-use`) or it still queues mutations
 * (`queued-mutations`). Never waits for the lock. A file Turso cannot read,
 * or whose queue cannot be counted, is kept and rejects; the caller should
 * use a disposable worker, because such a failure can poison the
 * worker-local OPFS registry.
 */
export function removeStaleCacheDatabase(scope: string, identity: string): Promise<any>;

/**
 * `formula` (a `Formula` as JSON) as users write it, with the current
 * names of the columns of `table` (an id) in `catalog`.
 *
 * # Errors
 *
 * Throws an `EngineError` when an argument cannot be read or the catalog
 * has no such table.
 */
export function renderFormula(catalog: any, table: string, formula: any): string;

/**
 * The rows `view` (a `DatabaseView` as JSON) shows, as a statement to
 * drive like any other.
 *
 * # Errors
 *
 * Throws an `EngineError` when the catalog or the view cannot be read, or
 * the view does not fit its table.
 */
export function runView(catalog: any, view: any): Query;

/**
 * Schema hash baked into this build (build diagnostics).
 */
export function schemaHash(): string;

/**
 * Install the worker's payload-free slow SQL callback before opening the cache.
 * Called only for statement executions strictly longer than 200 milliseconds.
 */
export function setSlowQueryCallback(callback: Function): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly setSlowQueryCallback: (a: any) => void;
    readonly __wbg_cacheengine_free: (a: number, b: number) => void;
    readonly cacheBuildInfo: () => [number, number, number];
    readonly cacheDatabaseIdentity: (a: number, b: number) => [number, number];
    readonly cacheengine_boundIdentity: (a: number) => any;
    readonly cacheengine_calendarCommit: (a: number, b: any) => any;
    readonly cacheengine_calendarRange: (a: number, b: any) => any;
    readonly cacheengine_checkpointIfDue: (a: number) => any;
    readonly cacheengine_claimNextMutation: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly cacheengine_clear: (a: number) => any;
    readonly cacheengine_close: (a: number) => any;
    readonly cacheengine_commitHydrate: (a: number) => any;
    readonly cacheengine_commitOptimisticWrite: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: any, m: any, n: number, o: number) => any;
    readonly cacheengine_contactReconcile: (a: number, b: any) => any;
    readonly cacheengine_contactSnapshot: (a: number, b: any) => any;
    readonly cacheengine_currentAuthority: (a: number, b: number, c: number) => any;
    readonly cacheengine_currentRevision: (a: number) => any;
    readonly cacheengine_currentStorageGeneration: (a: number) => any;
    readonly cacheengine_deferOptimisticWrite: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => any;
    readonly cacheengine_deleteKeys: (a: number, b: number, c: number) => any;
    readonly cacheengine_enqueueOptimisticMutation: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: any, k: any, l: any, m: any, n: any, o: number, p: number, q: number, r: number, s: number, t: any, u: any, v: number, w: number) => any;
    readonly cacheengine_entityFilter: (a: number, b: any) => any;
    readonly cacheengine_externalReset: (a: number) => any;
    readonly cacheengine_hydrateQuery: (a: number, b: number, c: number, d: number, e: number, f: any, g: any, h: number, i: number, j: any) => any;
    readonly cacheengine_inspectMutations: (a: number) => any;
    readonly cacheengine_inspectQuery: (a: number, b: number, c: number, d: number, e: number, f: any, g: any) => any;
    readonly cacheengine_inspectQueryVariants: (a: number, b: number, c: number, d: number, e: number, f: any) => any;
    readonly cacheengine_invalidateKeys: (a: number, b: number, c: number) => any;
    readonly cacheengine_peopleContext: (a: number, b: any) => any;
    readonly cacheengine_peopleReadSql: (a: number, b: any) => any;
    readonly cacheengine_peopleResolveReferences: (a: number, b: any) => any;
    readonly cacheengine_peopleSearch: (a: number, b: any) => any;
    readonly cacheengine_peopleUpdate: (a: number, b: any) => any;
    readonly cacheengine_physicalReset: (a: number) => any;
    readonly cacheengine_prepareHydrate: (a: number, b: number, c: number, d: number, e: number, f: any, g: any, h: number, i: number, j: any) => any;
    readonly cacheengine_queueDiagnostics: (a: number) => any;
    readonly cacheengine_readQuery: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any, i: any) => any;
    readonly cacheengine_readRecordsByKeys: (a: number, b: number, c: number, d: number, e: number, f: any) => any;
    readonly cacheengine_refreshOptimisticQueue: (a: number) => any;
    readonly cacheengine_rollbackOptimisticWrite: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly cacheengine_search: (a: number, b: any) => any;
    readonly cacheengine_stageHydrate: (a: number) => any;
    readonly cacheengine_stepHydrate: (a: number) => any;
    readonly cacheengine_teardownOperation: (a: number, b: number, c: number) => any;
    readonly cacheengine_transitionAuthority: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => any;
    readonly cacheengine_watchQuery: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: any, i: any, j: number, k: number) => any;
    readonly cacheengine_writeQuery: (a: number, b: any, c: number, d: number, e: number, f: number, g: any, h: any, i: number, j: number) => any;
    readonly configureCacheSchema: (a: number, b: number) => [number, number];
    readonly destroyCache: (a: number, b: number) => any;
    readonly openCache: (a: number, b: number, c: number) => any;
    readonly openCacheForRecovery: (a: number, b: number, c: number) => any;
    readonly openCacheForRecoveryWithOutcome: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly openCacheWithOutcome: (a: number, b: number, c: number, d: number, e: number) => any;
    readonly removeStaleCacheDatabase: (a: number, b: number, c: number, d: number) => any;
    readonly schemaHash: () => [number, number];
    readonly __wbg_query_free: (a: number, b: number) => void;
    readonly board: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly buildCatalog: (a: any, b: number, c: number) => [number, number, number];
    readonly describeRead: (a: any, b: number, c: number) => [number, number, number];
    readonly describeView: (a: any, b: any) => [number, number, number];
    readonly keyBetween: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly query_feed_bins: (a: number, b: number, c: any) => [number, number, number];
    readonly query_feed_page: (a: number, b: number, c: any) => [number, number, number];
    readonly query_new: (a: any, b: number, c: number) => [number, number, number];
    readonly query_start: (a: number) => [number, number, number];
    readonly readFormula: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly renderFormula: (a: any, b: number, c: number, d: any) => [number, number, number, number];
    readonly runView: (a: any, b: any) => [number, number, number];
    readonly regexp: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly register_regexp: (a: number) => number;
    readonly uuid4_str: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly uuid4_blob: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly uuid7_str: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly uuid7: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly uuid7_ts: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly uuid_str: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly uuid_blob: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    readonly register_uuid4_blob: (a: number) => number;
    readonly register_uuid4_str: (a: number) => number;
    readonly register_uuid7: (a: number) => number;
    readonly register_uuid7_str: (a: number) => number;
    readonly register_uuid7_ts: (a: number) => number;
    readonly register_uuid_blob: (a: number) => number;
    readonly register_uuid_str: (a: number) => number;
    readonly wasm_bindgen__convert__closures_____invoke__hc02891d67ab2131d: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h5c295e83d521e75b: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__ha1b86d2b81573745: (a: number, b: number, c: any) => any;
    readonly wasm_bindgen__convert__closures_____invoke__ha1b86d2b81573745_1: (a: number, b: number, c: any) => any;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
