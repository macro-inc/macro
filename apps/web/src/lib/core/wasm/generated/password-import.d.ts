/* tslint:disable */
/* eslint-disable */

/**
 * Sniffs the format of `bytes`.
 *
 * # Errors
 *
 * Throws only when the result can't be built.
 */
export function detect(bytes: Uint8Array): any;

/**
 * Parses `bytes` as `format` (`one_password_pux`, `one_password_csv`,
 * `bitwarden_json`, `bitwarden_csv` or `bitwarden_zip`) with the default limits.
 *
 * # Errors
 *
 * Throws when `format` is not one of those, or the result can't be built.
 */
export function parse(bytes: Uint8Array, format: string): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly detect: (a: number, b: number) => [number, number, number];
    readonly parse: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
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
