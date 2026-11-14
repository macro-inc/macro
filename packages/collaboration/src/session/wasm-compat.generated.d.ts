/* tslint:disable */
/* eslint-disable */

/**
 * The recorded throws reported in one native output, by tag-16 view-effect ordinal.
 * Copy it before consuming that output, then take each cause by (entry, cause).
 */
export class CodeTokenFailure {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Cause ids to take with `takeCodeTokenCause(entry, cause)`.
     */
    causes(): Uint32Array;
    /**
     * View-effect ordinals of the reported errors, parallel to `causes`.
     */
    effectOrdinals(): Uint32Array;
    /**
     * The session entry whose output reported these errors.
     */
    readonly entry: bigint;
}

/**
 * One host-owned generic document session.
 */
export class DocSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Account/capability notification.
     */
    authorization(current: boolean, can_write: boolean, can_comment: boolean, now: number, wall: number): number;
    /**
     * Cross-tab update, awareness or closing notification.
     */
    chatter(kind: number, data: Uint8Array, now: number, wall: number): number;
    /**
     * Construct a session; reject incompatible ABI majors before decoding configuration.
     */
    static create(abi_major: number, config: Uint8Array, now: number, wall: number): DocSession;
    /**
     * Lifecycle notification with fresh wall-clock origin.
     */
    host(signal: number, now: number, wall: number): number;
    /**
     * Deliver a cold Bebop input.
     */
    input(msg: Uint8Array, now: number, wall: number): number;
    /**
     * Read a complete generic value through a typed path, encoded in preorder.
     */
    read(path: Uint8Array): Uint8Array;
    /**
     * Physical close completion.
     */
    socketClosed(conn: number, code: number, clean: boolean, now: number, wall: number): number;
    /**
     * One raw framed binary message.
     */
    socketFrame(conn: number, frame: Uint8Array, now: number): number;
    /**
     * Physical socket opened.
     */
    socketOpened(conn: number, now: number, wall: number): number;
    /**
     * Physical text message.
     */
    socketText(conn: number, text: string, now: number): number;
    /**
     * Atomic orphan adoption completion; negative count denotes failure.
     */
    storageAdopted(op: number, adopted: number, failure: number, now: number, wall: number): number;
    /**
     * Durable write completion.
     */
    storageDone(op: number, ok: boolean, failure: number, now: number, wall: number): number;
    /**
     * Durable load completion.
     */
    storageLoaded(op: number, msg: Uint8Array | null | undefined, failure: number, now: number, wall: number): number;
    /**
     * Copy pending output; no borrowed linear-memory view escapes.
     */
    takeOutput(): Uint8Array;
    /**
     * The executor's single timer fired.
     */
    tick(now: number, wall: number): number;
    /**
     * Authorization fetch completion; token contents never enter telemetry.
     */
    tokenFetched(attempt: number, token: string | null | undefined, access: number, now: number, wall: number): number;
    /**
     * Earliest monotonic deadline, or -1.
     */
    wakeAt(): number;
}

/**
 * One host-owned editor session.
 */
export class EditorSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Account/capability notification.
     */
    authorization(current: boolean, can_write: boolean, can_comment: boolean, now: number, wall: number): number;
    /**
     * Cross-tab update, awareness or closing notification.
     */
    chatter(kind: number, data: Uint8Array, now: number, wall: number): number;
    /**
     * Clipboard formats: kind 0 copy, 1 cut, 2 complete block-drag subtrees.
     */
    clipboard(kind: number): Uint8Array;
    /**
     * Browser clipboard DOM, using the caller's configured theme and native selection export.
     */
    clipboardDom(kind: number, theme: string): Uint8Array;
    /**
     * Tokenizer throws never handed back: a second in one call, one outside any call, or one
     * not taken before the next call began.
     */
    codeTokenCausesDropped(): number;
    /**
     * Dispatch an allocation-light standard command.
     */
    command(code: number, a: number, b: number, text: string | null | undefined, now: number): number;
    /**
     * Observe retained captures and actual live nodes outside measured editing windows.
     */
    compatAuditSnapshot(): Uint8Array;
    /**
     * Apply an ordered native operation list and synchronously normalize its pending state.
     */
    compatBatch(request: Uint8Array): Uint8Array;
    /**
     * Open unpublished edits on this session's actual core.
     */
    compatBegin(tags: Uint8Array): void;
    /**
     * Begin a compact update with native key tickets and current composition state.
     */
    compatBeginCompact(request: Uint8Array): Uint8Array;
    /**
     * Hydrate an issued exact record without cloning, dirtying or changing its graph.
     */
    compatBindInstance(bytes: Uint8Array): Uint8Array;
    /**
     * Execute one typed operation in the live update or an exact historical read.
     */
    compatCall(request: Uint8Array): Uint8Array;
    /**
     * Drain exact retain/release metadata without opening an editor update.
     */
    compatCaptureLeases(input: Uint8Array): void;
    /**
     * Admit the staged update through the normal readiness, access and WAL path.
     */
    compatCommit(now: number, wall: number): Uint8Array;
    /**
     * Observe native publications outside the JS update path without reusing versions.
     */
    compatCurrentVersion(): bigint;
    /**
     * Discard unpublished edits without rolling back other session inputs.
     */
    compatDiscard(): void;
    /**
     * Close a flushed no-op without publishing a replacement state or listeners.
     */
    compatFinishNoop(): boolean;
    /**
     * Normalize the unpublished update without admitting or publishing it.
     */
    compatFlush(): void;
    /**
     * Release exactly one JS binding lease without releasing its graph.
     */
    compatReleaseSelection(reference: Uint8Array): void;
    /**
     * Release a retained historical publication and its captured host references.
     */
    compatReleaseVersion(version: bigint): void;
    /**
     * Refill an exhausted native key ticket block in the same update.
     */
    compatReserveKeys(count: number): Uint8Array;
    /**
     * Retain a value independently of its original allocation graph.
     */
    compatRetainSelection(reference: Uint8Array): void;
    /**
     * Synchronize one owned selection value against the caller's chosen graph.
     */
    compatSetSelection(request: Uint8Array): Uint8Array;
    /**
     * Capture the exact retained publication, including version zero.
     */
    compatSnapshot(version: bigint): Uint8Array;
    /**
     * Drain exact external commit receipts; repeated drains return no commits.
     */
    compatTakePublications(): Uint8Array;
    /**
     * Full IME primitive input, preserving UTF-16 offsets and composition data.
     */
    composition(kind: number, key: number, text: string | null | undefined, anchor_offset: number, focus_offset: number, data: string | null | undefined, now: number): number;
    /**
     * End IME composition with the displayed text.
     */
    compositionEnd(key: number, text: string, data: string | null | undefined, now: number): number;
    /**
     * Start IME composition in a text node.
     */
    compositionStart(key: number, offset: number, now: number): number;
    /**
     * Construct a session; reject incompatible ABI majors before decoding configuration.
     */
    static create(abi_major: number, config: Uint8Array, now: number, wall: number): EditorSession;
    /**
     * Create the JS-configured core with no parallel native editing plugins.
     */
    static createCompat(abi: number, config: Uint8Array, now: number, wall: number, registration: Uint8Array): EditorSession;
    /**
     * Construct the same core with registered numeric JS class lifecycle metadata.
     */
    static createCompatHosted(abi: number, config: Uint8Array, now: number, wall: number, registration: Uint8Array, host_slot: number): EditorSession;
    /**
     * Construct the application's MarkdownSync registry and projection policy.
     */
    static createMacro(abi_major: number, config: Uint8Array, now: number, wall: number, hostname?: string | null): EditorSession;
    /**
     * Construct the application editor with the host's actual instance namespace.
     *
     * `code_token_provider(op, language, text, profile)` returns a JSON string: for `op`
     * `"loaded"` (empty text) `{"kind":"loaded","loaded":bool}`, for `"tokenize"`
     * `{"kind":"tokens","tokens":[...]}`. It is supported only when wrapped by the
     * lexical-wasm-view `NativeEnterDispatcher.fenceCodeTokenProvider` (installed before
     * construction). A raw provider that reenters or frees a session corrupts wasm-bindgen
     * state; that use is unsupported.
     */
    static createMacroWithNamespace(abi_major: number, config: Uint8Array, now: number, wall: number, namespace: string, hostname?: string | null, write_root_search_text?: boolean | null, code_token_provider?: Function | null, code_token_profile?: string | null): EditorSession;
    /**
     * Full development insertion predicate using the host's resolved selection.
     */
    debugInsertion(selection: Uint8Array, format: number, style: string, text: string, facts: number): boolean;
    /**
     * Development cross-check for the host insertion predicate.
     */
    debugShouldPreventDefault(index: number, offset: number, text: string): boolean;
    /**
     * Development checksum of the complete rendered tree.
     */
    debugViewChecksum(): number;
    /**
     * Observe current authorization using the generated Access enum values.
     * This neither consumes output nor authorizes a later mutation.
     */
    effectiveAccess(): number;
    /**
     * Select listener-metadata transport for one actual ordinary Port binding.
     * Does not admit editing, commit, initialize a view, or transfer pending output.
     */
    enableViewListenerMetadata(owner: bigint): void;
    /**
     * Lifecycle notification with fresh wall-clock origin.
     */
    host(signal: number, now: number, wall: number): number;
    /**
     * Cold recovery patch from an empty view; does not reset sync or history.
     */
    initialize(): Uint8Array;
    /**
     * Deliver a cold Bebop input.
     */
    input(msg: Uint8Array, now: number, wall: number): number;
    /**
     * Key routing computed by the host view.
     */
    keyDown(code: number, mods: number, routed: number, key: string, anchor_key: number, anchor_offset: number, anchor_type: number, focus_key: number, focus_offset: number, focus_type: number, selection_kind: number, now: number): number;
    /**
     * Receipt-preserving metadata snapshot; root registrations may refresh it.
     */
    listenerTable(): Uint8Array;
    /**
     * Bulk Markdown export: Macro sessions use internal/external lists for flavors 0/1.
     * Built-in sessions retain upstream conversion and flavor-specific indentation.
     */
    markdown(flavor: number): string;
    /**
     * Text for a node already addressed by the view.
     */
    nodeText(key: number): string;
    /**
     * Bulk typed read queries; no per-node JavaScript callbacks.
     */
    query(msg: Uint8Array): Uint8Array;
    /**
     * Install the single block-navigation callback at fixed LOW/Before ordering.
     */
    registerViewBlockNavigation(down: boolean, callback: bigint): bigint;
    /**
     * Register Enter at the named native priority, after existing equal listeners.
     */
    registerViewEnter(callback: bigint, priority: number): bigint;
    /**
     * Register Escape after existing listeners at the same native priority.
     */
    registerViewEscape(callback: bigint, priority: number): bigint;
    /**
     * Retire the detached synchronous view's component observation baseline.
     * Queued output and durable session state remain owned by the executor.
     */
    retireViewObservation(): void;
    /**
     * Download-safe Macro JSON with regenerated search text and transient nodes removed.
     */
    savedState(): string;
    /**
     * Install resolved anchor and focus in one crossing.
     */
    selectionFromView(anchor_key: number, anchor_offset: number, anchor_type: number, focus_key: number, focus_offset: number, focus_type: number, now: number): number;
    /**
     * Raw live editor JSON, including local UI state.
     */
    serializedState(): string;
    /**
     * Physical close completion.
     */
    socketClosed(conn: number, code: number, clean: boolean, now: number, wall: number): number;
    /**
     * One raw framed binary message.
     */
    socketFrame(conn: number, frame: Uint8Array, now: number): number;
    /**
     * Physical socket opened.
     */
    socketOpened(conn: number, now: number, wall: number): number;
    /**
     * Physical text message.
     */
    socketText(conn: number, text: string, now: number): number;
    /**
     * Atomic orphan adoption completion; negative count denotes failure.
     */
    storageAdopted(op: number, adopted: number, failure: number, now: number, wall: number): number;
    /**
     * Durable write completion.
     */
    storageDone(op: number, ok: boolean, failure: number, now: number, wall: number): number;
    /**
     * Durable load completion.
     */
    storageLoaded(op: number, msg: Uint8Array | null | undefined, failure: number, now: number, wall: number): number;
    /**
     * The original thrown value as `[value]`, so a thrown `undefined` is distinguishable;
     * `undefined` for any pair this session did not report or already gave out.
     */
    takeCodeTokenCause(entry: bigint, cause: number): Array<any> | undefined;
    /**
     * Recorded code-tokenizer throws reported in the latest output, taken once.
     */
    takeCodeTokenFailure(): CodeTokenFailure | undefined;
    /**
     * Copy pending output; no borrowed linear-memory view escapes.
     * Observation validation failure preserves queued output and returns an error.
     */
    takeOutput(): Uint8Array;
    /**
     * Take only the actual reported callback-failure scope after consuming output.
     */
    takeViewCommandFailure(): ViewCommandFailure | undefined;
    /**
     * Current complete document text in one crossing.
     */
    textContent(): string;
    /**
     * DOM-first text input. UTF-16 decoding rejects unpaired surrogates.
     */
    textFromView(key: number, text: string, anchor_offset: number, focus_offset: number, sel_kind: number, flags: number, composition_data: string | null | undefined, now: number): number;
    /**
     * The executor's single timer fired.
     */
    tick(now: number, wall: number): number;
    /**
     * Authorization fetch completion; token contents never enter telemetry.
     */
    tokenFetched(attempt: number, token: string | null | undefined, access: number, now: number, wall: number): number;
    /**
     * Registered types and static predicate flags; bit zero marks known flags.
     */
    typeTable(): Uint8Array;
    /**
     * Remove a stable logical Enter registration; repeated cleanup is harmless.
     */
    unregisterViewEnter(handle: bigint): void;
    /**
     * Remove a stable Escape registration; repeated cleanup is harmless.
     */
    unregisterViewEscape(handle: bigint): void;
    /**
     * Admit a genuine programmatic Enter with an explicit null JS event payload.
     */
    viewCommandEnter(now: number, wall: number): number;
    /**
     * Admit a programmatic Escape with an explicit null JS event payload.
     */
    viewCommandEscape(now: number, wall: number): number;
    /**
     * Return this session's checked ordinary view-command owner identity.
     */
    viewCommandOwner(): bigint;
    /**
     * Earliest monotonic deadline, or -1.
     */
    wakeAt(): number;
}

/**
 * Shared physical transport with native per-document subscription policy.
 */
export class SyncRouter {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Attach one session owner to a document route.
     */
    attach(doc: string, token?: string | null): number;
    /**
     * Construct the shared router; configuration uses the same policy envelope.
     */
    static create(abi: number, config: Uint8Array, now: number, wall: number): SyncRouter;
    /**
     * Detach one owner without closing other routes.
     */
    detach(doc: string): number;
    /**
     * Lifecycle and network signal.
     */
    host(signal: number, now: number, wall: number): number;
    /**
     * Refresh a route independently of the physical socket.
     */
    reconnect(doc: string, now: number, wall: number): number;
    /**
     * Forward an already framed document message.
     */
    send(doc: string, frame: Uint8Array, now: number, wall: number): number;
    /**
     * Physical close completion.
     */
    socketClosed(conn: number, code: number, clean: boolean, now: number, wall: number): number;
    /**
     * One outer router frame, decoded entirely by Rust.
     */
    socketFrame(conn: number, frame: Uint8Array, now: number, wall: number): number;
    /**
     * Physical connection opened.
     */
    socketOpened(conn: number, now: number, wall: number): number;
    /**
     * Physical protocol text.
     */
    socketText(conn: number, text: string, now: number, wall: number): number;
    /**
     * Copy pending router I/O and per-document events.
     */
    takeOutput(): Uint8Array;
    /**
     * Shared timer callback.
     */
    tick(now: number, wall: number): number;
    /**
     * Per-document token fetch completion.
     */
    tokenFetched(doc: string, attempt: number, token: string | null | undefined, access: number, now: number, wall: number): number;
    /**
     * Earliest shared deadline or -1.
     */
    wakeAt(): number;
}

/**
 * Exact reported callback error positions in one encoded native output.
 * Copy this metadata before consuming that output; resolve the JS cause afterwards.
 */
export class ViewCommandFailure {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Exact tag-16 view-effect ordinals; unrelated error effects must still run.
     */
    effectOrdinals(): Uint32Array;
    /**
     * Whether these ordinals still belong to the current native output.
     * A subsequent real input invalidates them; pure metadata reads do not.
     */
    readonly current: boolean;
    /**
     * Actual outer native invocation associated with this output.
     */
    readonly invocation: bigint;
    /**
     * Issued scope whose invocation-owned JS slot retains the original cause.
     */
    readonly scope: bigint;
}

/**
 * Static callback entry point; never receives an already-borrowed EditorSession.
 */
export function compatibilityCallbackCall(host_slot: number, scope_id: bigint, bytes: Uint8Array): Uint8Array;

/**
 * Hook names in the generated production class-mask order.
 */
export function compatibility_hook_index(): string[];

/**
 * Exact compatibility envelope version required before editor construction.
 */
export function compatibility_protocol_major(): number;

/**
 * Exact generated schema fingerprint required by the production JS backend.
 */
export function compatibility_schema_hash(): string;

/**
 * Install the single module-stable dispatcher; editor slots remain weak in JS.
 */
export function installCompatibilityHost(dispatcher: Function): void;

/**
 * Install the ordinary synchronous Enter dispatcher and original-cause lookup.
 * The dispatcher owns its event stack and stores thrown values by issued scope.
 */
export function installViewCommandHost(dispatch: Function, lookup: Function): void;

/**
 * Prepare the MarkdownSync linkifier before editors accept their first paste.
 * The host schedules this after paint while preparing the shared editor engine.
 */
export function prepareMacroPaste(): void;

/**
 * Request observation retirement from the exact current callback metadata scope.
 * The native epilogue performs retirement after callback/model borrows end.
 */
export function requestRetireViewObservation(owner: bigint, invocation: bigint, scope: bigint): void;

/**
 * Return only the issued DOM measurement key, never a mutable host target.
 */
export function viewCommandScopeBlockNavigationBlock(scope: bigint, plan: bigint): number | undefined;

/**
 * Consume an issued plan after host teardown or failed measurement, without selecting.
 */
export function viewCommandScopeCancelBlockNavigation(scope: bigint, plan: bigint): void;

/**
 * Consume the exact issued plan before validating optional fresh DOM geometry.
 */
export function viewCommandScopeCompleteBlockNavigation(scope: bigint, plan: bigint, block_top?: number | null, block_bottom?: number | null, caret_top?: number | null, caret_bottom?: number | null, caret_height?: number | null): boolean;

/**
 * Dispatch a whitelisted ordinary command or current-generation application.
 */
export function viewCommandScopeDispatch(scope: bigint, encoded: Uint8Array): boolean;

/**
 * Dispatch a nested programmatic Enter; its JS payload is explicitly null.
 */
export function viewCommandScopeEnter(scope: bigint): boolean;

/**
 * Dispatch a nested programmatic Escape with an explicit null JS payload.
 */
export function viewCommandScopeEscape(scope: bigint): boolean;

/**
 * Export one pending node's own JSON through its actual configured hook.
 */
export function viewCommandScopeOwnJSON(scope: bigint, key: number): string;

/**
 * Issue a one-shot plan from the current fixed vertical-navigation callback.
 */
export function viewCommandScopePrepareBlockNavigation(scope: bigint): bigint;

/**
 * Append or deduplicate an Enter listener in the actual current transaction.
 */
export function viewCommandScopeRegisterEnter(scope: bigint, callback: bigint, priority: number): bigint;

/**
 * Append or deduplicate an Escape listener in the current transaction.
 */
export function viewCommandScopeRegisterEscape(scope: bigint, callback: bigint, priority: number): bigint;

/**
 * Read the actual pending selection using the existing SelectionMsg encoding.
 */
export function viewCommandScopeSelection(scope: bigint): Uint8Array;

/**
 * Apply an explicit view selection to the borrowed transaction.
 */
export function viewCommandScopeSetSelection(scope: bigint, encoded: Uint8Array): void;

/**
 * Read pending node text without consulting the published view mirror.
 */
export function viewCommandScopeText(scope: bigint, key: number): string;

/**
 * Remove an actual listener while preserving current native bucket snapshots.
 */
export function viewCommandScopeUnregisterEnter(scope: bigint, handle: bigint): void;

/**
 * Remove an Escape registration while retaining current bucket snapshots.
 */
export function viewCommandScopeUnregisterEscape(scope: bigint, handle: bigint): void;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_codetokenfailure_free: (a: number, b: number) => void;
    readonly __wbg_docsession_free: (a: number, b: number) => void;
    readonly __wbg_editorsession_free: (a: number, b: number) => void;
    readonly __wbg_syncrouter_free: (a: number, b: number) => void;
    readonly __wbg_viewcommandfailure_free: (a: number, b: number) => void;
    readonly codetokenfailure_causes: (a: number) => [number, number];
    readonly codetokenfailure_effectOrdinals: (a: number) => [number, number];
    readonly codetokenfailure_entry: (a: number) => bigint;
    readonly compatibilityCallbackCall: (a: number, b: bigint, c: number, d: number) => [number, number, number, number];
    readonly compatibility_hook_index: () => [number, number];
    readonly compatibility_protocol_major: () => number;
    readonly compatibility_schema_hash: () => [number, number];
    readonly docsession_authorization: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly docsession_chatter: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly docsession_create: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly docsession_host: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly docsession_input: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly docsession_read: (a: number, b: number, c: number) => [number, number, number, number];
    readonly docsession_socketClosed: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly docsession_socketFrame: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly docsession_socketOpened: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly docsession_socketText: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly docsession_storageAdopted: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly docsession_storageDone: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly docsession_storageLoaded: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly docsession_takeOutput: (a: number) => [number, number];
    readonly docsession_tick: (a: number, b: number, c: number) => [number, number, number];
    readonly docsession_tokenFetched: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly docsession_wakeAt: (a: number) => number;
    readonly editorsession_authorization: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly editorsession_chatter: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly editorsession_clipboard: (a: number, b: number) => [number, number, number, number];
    readonly editorsession_clipboardDom: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly editorsession_codeTokenCausesDropped: (a: number) => number;
    readonly editorsession_command: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly editorsession_compatAuditSnapshot: (a: number) => [number, number, number, number];
    readonly editorsession_compatBatch: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorsession_compatBegin: (a: number, b: number, c: number) => [number, number];
    readonly editorsession_compatBeginCompact: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorsession_compatBindInstance: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorsession_compatCall: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorsession_compatCaptureLeases: (a: number, b: number, c: number) => [number, number];
    readonly editorsession_compatCommit: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorsession_compatCurrentVersion: (a: number) => [bigint, number, number];
    readonly editorsession_compatDiscard: (a: number) => [number, number];
    readonly editorsession_compatFinishNoop: (a: number) => [number, number, number];
    readonly editorsession_compatFlush: (a: number) => [number, number];
    readonly editorsession_compatReleaseSelection: (a: number, b: number, c: number) => [number, number];
    readonly editorsession_compatReleaseVersion: (a: number, b: bigint) => [number, number];
    readonly editorsession_compatReserveKeys: (a: number, b: number) => [number, number, number, number];
    readonly editorsession_compatRetainSelection: (a: number, b: number, c: number) => [number, number];
    readonly editorsession_compatSetSelection: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorsession_compatSnapshot: (a: number, b: bigint) => [number, number, number, number];
    readonly editorsession_compatTakePublications: (a: number) => [number, number, number, number];
    readonly editorsession_composition: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly editorsession_compositionEnd: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly editorsession_compositionStart: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly editorsession_create: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly editorsession_createCompat: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly editorsession_createCompatHosted: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly editorsession_createMacro: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly editorsession_createMacroWithNamespace: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
    readonly editorsession_debugInsertion: (a: number, b: number, c: number, d: number, e: number, f: number, g: any, h: number) => [number, number, number];
    readonly editorsession_debugShouldPreventDefault: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly editorsession_debugViewChecksum: (a: number) => [number, number, number];
    readonly editorsession_effectiveAccess: (a: number) => number;
    readonly editorsession_enableViewListenerMetadata: (a: number, b: bigint) => [number, number];
    readonly editorsession_host: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly editorsession_initialize: (a: number) => [number, number, number, number];
    readonly editorsession_input: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly editorsession_keyDown: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
    readonly editorsession_listenerTable: (a: number) => [number, number, number, number];
    readonly editorsession_markdown: (a: number, b: number) => [number, number, number, number];
    readonly editorsession_nodeText: (a: number, b: number) => [number, number];
    readonly editorsession_query: (a: number, b: number, c: number) => [number, number, number, number];
    readonly editorsession_registerViewBlockNavigation: (a: number, b: number, c: bigint) => [bigint, number, number];
    readonly editorsession_registerViewEnter: (a: number, b: bigint, c: number) => [bigint, number, number];
    readonly editorsession_registerViewEscape: (a: number, b: bigint, c: number) => [bigint, number, number];
    readonly editorsession_retireViewObservation: (a: number) => void;
    readonly editorsession_savedState: (a: number) => [number, number, number, number];
    readonly editorsession_selectionFromView: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly editorsession_serializedState: (a: number) => [number, number, number, number];
    readonly editorsession_socketClosed: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly editorsession_socketFrame: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly editorsession_socketOpened: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly editorsession_socketText: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly editorsession_storageAdopted: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly editorsession_storageDone: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly editorsession_storageLoaded: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly editorsession_takeCodeTokenCause: (a: number, b: bigint, c: number) => any;
    readonly editorsession_takeCodeTokenFailure: (a: number) => number;
    readonly editorsession_takeOutput: (a: number) => [number, number, number, number];
    readonly editorsession_takeViewCommandFailure: (a: number) => [number, number, number];
    readonly editorsession_textContent: (a: number) => [number, number];
    readonly editorsession_textFromView: (a: number, b: number, c: any, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly editorsession_tick: (a: number, b: number, c: number) => [number, number, number];
    readonly editorsession_tokenFetched: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly editorsession_typeTable: (a: number) => [number, number, number, number];
    readonly editorsession_unregisterViewEnter: (a: number, b: bigint) => [number, number];
    readonly editorsession_viewCommandEnter: (a: number, b: number, c: number) => [number, number, number];
    readonly editorsession_viewCommandEscape: (a: number, b: number, c: number) => [number, number, number];
    readonly editorsession_viewCommandOwner: (a: number) => [bigint, number, number];
    readonly installCompatibilityHost: (a: any) => [number, number];
    readonly installViewCommandHost: (a: any, b: any) => [number, number];
    readonly prepareMacroPaste: () => [number, number];
    readonly requestRetireViewObservation: (a: bigint, b: bigint, c: bigint) => [number, number];
    readonly syncrouter_attach: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly syncrouter_create: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly syncrouter_detach: (a: number, b: number, c: number) => [number, number, number];
    readonly syncrouter_host: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly syncrouter_reconnect: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly syncrouter_send: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly syncrouter_socketClosed: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly syncrouter_socketFrame: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly syncrouter_socketOpened: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly syncrouter_socketText: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly syncrouter_takeOutput: (a: number) => [number, number];
    readonly syncrouter_tick: (a: number, b: number, c: number) => [number, number, number];
    readonly syncrouter_tokenFetched: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly syncrouter_wakeAt: (a: number) => number;
    readonly viewCommandScopeBlockNavigationBlock: (a: bigint, b: bigint) => [number, number, number];
    readonly viewCommandScopeCancelBlockNavigation: (a: bigint, b: bigint) => [number, number];
    readonly viewCommandScopeCompleteBlockNavigation: (a: bigint, b: bigint, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
    readonly viewCommandScopeDispatch: (a: bigint, b: number, c: number) => [number, number, number];
    readonly viewCommandScopeEnter: (a: bigint) => [number, number, number];
    readonly viewCommandScopeEscape: (a: bigint) => [number, number, number];
    readonly viewCommandScopeOwnJSON: (a: bigint, b: number) => [number, number, number, number];
    readonly viewCommandScopePrepareBlockNavigation: (a: bigint) => [bigint, number, number];
    readonly viewCommandScopeRegisterEnter: (a: bigint, b: bigint, c: number) => [bigint, number, number];
    readonly viewCommandScopeRegisterEscape: (a: bigint, b: bigint, c: number) => [bigint, number, number];
    readonly viewCommandScopeSelection: (a: bigint) => [number, number, number, number];
    readonly viewCommandScopeSetSelection: (a: bigint, b: number, c: number) => [number, number];
    readonly viewCommandScopeText: (a: bigint, b: number) => [number, number, number, number];
    readonly viewCommandScopeUnregisterEnter: (a: bigint, b: bigint) => [number, number];
    readonly viewcommandfailure_current: (a: number) => number;
    readonly viewcommandfailure_effectOrdinals: (a: number) => [number, number];
    readonly viewcommandfailure_invocation: (a: number) => bigint;
    readonly editorsession_unregisterViewEscape: (a: number, b: bigint) => [number, number];
    readonly viewCommandScopeUnregisterEscape: (a: bigint, b: bigint) => [number, number];
    readonly viewcommandfailure_scope: (a: number) => bigint;
    readonly editorsession_wakeAt: (a: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
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
