/* tslint:disable */
/* eslint-disable */

/**
 * One live session's fold, held open between inputs.
 *
 * Wraps [`SpeculativeFold`], which wraps the same
 * [`crate::domain::fold::FoldMachineImpl`] the server folds with. A caller
 * following a session keeps one of these per session for as long as the
 * session lasts and pushes every input through [`Self::push`]: the fetched
 * log and the streamed frames after it go into one machine, so a channel
 * opened mid-session continues the fold rather than starting a second one
 * beside it.
 */
export class FoldStream {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Every message as the reader should see it, oldest first - the
     * confirmed conversation with this client's unconfirmed actions on top.
     *
     * # Errors
     *
     * Returns a JS string describing what could not be encoded.
     */
    messages(): any;
    /**
     * The session metadata as it now stands - what the latest
     * `{kind: "metadata"}` event carried.
     *
     * # Errors
     *
     * Returns a JS string describing what could not be encoded.
     */
    metadata(): any;
    /**
     * A fold for `session_id` that has seen nothing. The first input pushed
     * must be a snapshot.
     *
     * # Errors
     *
     * Returns a JS string when the session id is not a UUID.
     */
    constructor(session_id: string);
    /**
     * Fold inputs in order, reporting the changes they implied as an array
     * of `{kind: "new" | "update", message}`, `{kind: "replace", messages}`
     * and `{kind: "metadata", metadata}` events. Empty for inputs that
     * change nothing renderable, which is most confirmed rows.
     *
     * # Errors
     *
     * Returns a JS string when an input cannot be read, when a live or
     * speculative input arrives before any snapshot, or when an action
     * cannot be encoded as the frame the harness would log.
     */
    push(inputs: any): any;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_foldstream_free: (a: number, b: number) => void;
    readonly foldstream_messages: (a: number) => [number, number, number];
    readonly foldstream_metadata: (a: number) => [number, number, number];
    readonly foldstream_new: (a: number, b: number) => [number, number, number];
    readonly foldstream_push: (a: number, b: any) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
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
