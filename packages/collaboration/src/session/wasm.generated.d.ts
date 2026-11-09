/* tslint:disable */
/* eslint-disable */

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
     * Dispatch an allocation-light standard command.
     */
    command(code: number, a: number, b: number, text: string | null | undefined, now: number): number;
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
     * Construct the application's MarkdownSync registry and projection policy.
     */
    static createMacro(abi_major: number, config: Uint8Array, now: number, wall: number, hostname?: string | null): EditorSession;
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
     * Command listener priorities read once at open.
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
     * Copy pending output; no borrowed linear-memory view escapes.
     */
    takeOutput(): Uint8Array;
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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_docsession_free: (a: number, b: number) => void;
    readonly __wbg_editorsession_free: (a: number, b: number) => void;
    readonly __wbg_syncrouter_free: (a: number, b: number) => void;
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
    readonly editorsession_command: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly editorsession_composition: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly editorsession_compositionEnd: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly editorsession_compositionStart: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly editorsession_create: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly editorsession_createMacro: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly editorsession_debugInsertion: (a: number, b: number, c: number, d: number, e: number, f: number, g: any, h: number) => [number, number, number];
    readonly editorsession_debugShouldPreventDefault: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly editorsession_debugViewChecksum: (a: number) => [number, number, number];
    readonly editorsession_host: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly editorsession_initialize: (a: number) => [number, number, number, number];
    readonly editorsession_input: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly editorsession_keyDown: (a: number, b: number, c: number, d: number, e: any, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number, number];
    readonly editorsession_listenerTable: (a: number) => [number, number, number, number];
    readonly editorsession_markdown: (a: number, b: number) => [number, number, number, number];
    readonly editorsession_nodeText: (a: number, b: number) => [number, number];
    readonly editorsession_query: (a: number, b: number, c: number) => [number, number, number, number];
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
    readonly editorsession_takeOutput: (a: number) => [number, number];
    readonly editorsession_textContent: (a: number) => [number, number];
    readonly editorsession_textFromView: (a: number, b: number, c: any, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly editorsession_tick: (a: number, b: number, c: number) => [number, number, number];
    readonly editorsession_tokenFetched: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly editorsession_typeTable: (a: number) => [number, number, number, number];
    readonly editorsession_wakeAt: (a: number) => number;
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
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
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
