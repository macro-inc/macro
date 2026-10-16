/**
 * Typed surface of the `database_sql` wasm package, loaded on first use.
 * `just build-database-sql-wasm` builds it into the gitignored `./wasm/`.
 */

import type {
  Bin,
  Board,
  CardPosition,
  Catalog,
  DatabaseView,
  Formula,
  FormulaReading,
  Outcome,
  Page,
  Schema,
  Step,
} from './generated/types';

/**
 * One statement in flight, mirroring `database_sql::wasm::Query`: start once, then feed
 * each request's answer back until `done`. Every method throws an `EngineError`.
 */
export interface DatabaseSqlQuery {
  start: () => Step;
  feed_page: (requestId: number, page: Page) => Step;
  feed_bins: (requestId: number, bins: Bin[]) => Step;
  /** Releases the engine's wasm memory. */
  free: () => void;
}

interface DatabaseSqlWasmModule {
  default: (input?: { module_or_path?: unknown }) => Promise<unknown>;
  /** Compiles a statement. Throws an `EngineError` when it does not compile. */
  Query: new (
    catalog: Catalog,
    sql: string
  ) => DatabaseSqlQuery;
  /** The catalog a statement run from `scope` sees. Throws an `EngineError`. */
  buildCatalog: (schema: Schema, scope: string | undefined) => Catalog;
  /** The rows a view shows, as a query to drive. Throws an `EngineError`. */
  runView: (catalog: Catalog, view: DatabaseView) => DatabaseSqlQuery;
  /** A board view's lanes and cards. Throws an `EngineError`. */
  board: (
    catalog: Catalog,
    view: DatabaseView,
    outcome: Outcome,
    positions: CardPosition[]
  ) => Board;
  /** A position key between two others; `null` leaves that side open. Throws an `Error`. */
  keyBetween: (before: string | null, after: string | null) => string;
  /**
   * What `text` reads as, typed as the formula of a derived column of `table`;
   * `own` is that column once it exists. Throws an `EngineError`.
   */
  readFormula: (
    catalog: Catalog,
    table: string,
    own: string | undefined,
    text: string
  ) => FormulaReading;
  /** A formula as users write it, with the table's current column names. Throws an `EngineError`. */
  renderFormula: (catalog: Catalog, table: string, formula: Formula) => string;
}

let modulePromise: Promise<DatabaseSqlWasmModule> | undefined;

/** Loads and initializes the wasm module once per context; a failed load is tried again. */
export function loadDatabaseSqlWasm(): Promise<DatabaseSqlWasmModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      try {
        const url = new URL('./wasm/database_sql.js', import.meta.url).href;
        const wasm = (await import(
          /* @vite-ignore */ url
        )) as DatabaseSqlWasmModule;
        // The generated JS's own relative wasm URL 404s in production; a static
        // `new URL` makes vite emit and rewrite the binary.
        const wasmUrl = new URL('./wasm/database_sql_bg.wasm', import.meta.url);
        await wasm.default({ module_or_path: wasmUrl });
        return wasm;
      } catch (error) {
        modulePromise = undefined;
        throw error;
      }
    })();
  }
  return modulePromise;
}

/** Compile `sql` against `catalog` in the wasm engine, loading it on first use. */
export async function openDatabaseSqlQuery(
  catalog: Catalog,
  sql: string
): Promise<DatabaseSqlQuery> {
  const { Query } = await loadDatabaseSqlWasm();
  return new Query(catalog, sql);
}

/** Open `view`'s rows as a query against `catalog`, loading the engine on first use. */
export async function openDatabaseViewQuery(
  catalog: Catalog,
  view: DatabaseView
): Promise<DatabaseSqlQuery> {
  const { runView } = await loadDatabaseSqlWasm();
  return runView(catalog, view);
}

/** The catalog a statement run from `scope` sees, built by the engine. */
export async function buildDatabaseSqlCatalog(
  schema: Schema,
  scope?: string
): Promise<Catalog> {
  const { buildCatalog } = await loadDatabaseSqlWasm();
  return buildCatalog(schema, scope);
}
