/* tslint:disable */
/* eslint-disable */

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
 * A position key that sorts after `before` and before `after`; leave one
 * out to place it first or last.
 *
 * # Errors
 *
 * Throws an `Error` when a bound is not a key or they are out of order.
 */
export function keyBetween(before?: string | null, after?: string | null): string;

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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
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
