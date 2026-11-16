/**
 * The `database_sql` wasm module with its values typed by the specta types:
 * the generated declarations type them `any`.
 */
import databaseSqlWasm from 'wasm:database-sql';

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
  ReadDescription,
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
  /** Compiles a statement. Throws an `EngineError` when it does not compile. */
  Query: new (
    catalog: Catalog,
    sql: string
  ) => DatabaseSqlQuery;
  /** The catalog a statement run from `scope` sees. Throws an `EngineError`. */
  buildCatalog: (schema: Schema, scope: string | undefined) => Catalog;
  /** Read-only metadata from the same compiler used to execute the statement. */
  describeRead: (catalog: Catalog, sql: string) => ReadDescription;
  describeView: (catalog: Catalog, view: DatabaseView) => ReadDescription;
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

/** Loads the module once per context; a failed load is tried again. */
export async function loadDatabaseSqlWasm(): Promise<DatabaseSqlWasmModule> {
  // Checked against the generated declarations.
  const engine: DatabaseSqlWasmModule = await databaseSqlWasm.load();
  return engine;
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

/** Resolve actual table dependencies without fetching any rows. Writes fail closed. */
export async function describeDatabaseRead(
  catalog: Catalog,
  input: { sql: string } | { view: DatabaseView }
): Promise<ReadDescription> {
  const wasm = await loadDatabaseSqlWasm();
  return 'sql' in input
    ? wasm.describeRead(catalog, input.sql)
    : wasm.describeView(catalog, input.view);
}

/** The catalog a statement run from `scope` sees, built by the engine. */
export async function buildDatabaseSqlCatalog(
  schema: Schema,
  scope?: string
): Promise<Catalog> {
  const { buildCatalog } = await loadDatabaseSqlWasm();
  return buildCatalog(schema, scope);
}
