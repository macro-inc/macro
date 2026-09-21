/**
 * Macro Databases client.
 *
 * Hand-written mirror of the Rust DTOs in `crates/databases`
 * (`src/inbound/axum_router.rs` for the request/response bodies,
 * `src/domain/models.rs` for the entities). The document storage service
 * mounts the router under `/databases`.
 *
 * These types are hand-maintained until the storage-service OpenAPI
 * generation covers the databases routes; once `bun gen-api cloud-storage`
 * emits them, replace the declarations below with the generated schemas.
 */
import { ENABLE_BEARER_TOKEN_AUTH } from '@core/constant/featureFlags';
import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  type FetchWithTokenInit,
  fetchToken,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import { getMacroApiToken } from '@service-auth/fetch';
import type { DataType } from '@service-properties/generated/schemas/dataType';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { PropertyOption } from '@service-properties/generated/schemas/propertyOption';
import type { PropertyOwner } from '@service-properties/generated/schemas/propertyOwner';
import type { Result } from 'neverthrow';

/** What a viewer may do with a database (`AccessGrant`). */
export type DatabaseGrant = 'view' | 'comment' | 'edit' | 'owner';

/** A database: a named collection of tables, shared as one entity. */
export interface DatabaseSummary {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
  trashed_at: string | null;
}

/** A database as listed for a viewer (`ListedDatabase`). */
export interface ListedDatabase {
  database: DatabaseSummary;
  grant: DatabaseGrant;
}

/** One table (tab) of a database. */
export interface DatabaseTable {
  id: string;
  database_id: string;
  name: string;
  position: string;
  /** Monotonic version, bumped on every row/column/link mutation. */
  version: number;
}

/** Column-kind specific configuration stored on a column placement. */
export type ColumnConfig =
  | { kind: 'link'; database_id: string; table_id: string }
  | { kind: 'lookup'; via_column_id: string; target: string };

/** The placement of a property definition on a table. */
export interface DatabaseColumn {
  id: string;
  table_id: string;
  property_definition_id: string;
  position: string;
  config: ColumnConfig | null;
  /** Placement label; omitted by older servers. SQL names stay unchanged. */
  display_name?: string | null;
  infer_type?: boolean;
}

/** Committed label and table version from a column rename. */
export interface RenameColumnOutcome {
  column: DatabaseColumn;
  table_version: number;
}

/** The property definition behind a column. */
export interface DatabasePropertyDefinition {
  id: string;
  /**
   * A database column's definition is scoped to its database — the
   * `{ scope: 'database' }` variant of the generated `PropertyOwner`.
   */
  owner: PropertyOwner;
  display_name: string;
  data_type: DataType;
  is_multi_select: boolean;
  specific_entity_type: EntityType | null;
  created_at: string;
  updated_at: string;
  is_system: boolean;
  is_metadata: boolean;
}

/** A definition together with its select options. */
export interface DatabasePropertyDefinitionWithOptions {
  definition: DatabasePropertyDefinition;
  property_options: PropertyOption[];
}

/** One column placement with the definition behind it (`ColumnDetail`). */
export interface DatabaseColumnDetail {
  column: DatabaseColumn;
  /** Name to use in SQL. */
  sql_name: string;
  definition: DatabasePropertyDefinitionWithOptions;
  /** Whether SQL may write this column. */
  writable: boolean;
  /** Exact catalog names: relation junctions may be disambiguated. */
  junction_sql_name?: string | null;
  read_junction_sql_name?: string | null;
  /** Relation cells are projections; edit through the writable junction. */
  junction_writable?: boolean;
}

/** One table with its columns and SQL name (`TableDetail`). */
export interface DatabaseTableDetail {
  table: DatabaseTable;
  /** Physical name used by SQL writes (`INSERT INTO guests`). */
  sql_name: string;
  /** Immutable read-only alias, available even when display names change. */
  read_sql_name?: string;
  columns: DatabaseColumnDetail[];
}

/** Everything a client needs to render and edit one database. */
export interface DatabaseDetail {
  database: DatabaseSummary;
  grant: DatabaseGrant;
  tables: DatabaseTableDetail[];
}

/** A cell value as the SQLite materialization produced it. */
export type SqlValue = string | number | null;

/** One result column with its origin. */
export interface ResultColumn {
  name: string;
  /** Entity type of id values, when known — drives chip rendering. */
  entity_type: string | null;
  /** Origin `[table, column]` when the column traces to one base column. */
  origin: [string, string] | null;
}

/** One SELECT's result set. */
export interface QueryResult {
  columns: ResultColumn[];
  rows: SqlValue[][];
}

/** Outcome of `POST /databases/exec`. */
export interface ExecOutcome {
  /** Result sets of the SELECT statements, in order. */
  results: QueryResult[];
  /** How many row changes were applied. */
  changes_applied: number;
  /** Server-minted ids for inserted rows. */
  inserted_row_ids: string[];
  /** New versions of every written table, keyed by table id. */
  new_versions: Record<string, number>;
  /** Tables the statement read, for liveness subscription. */
  read_tables: string[];
  /** Parent databases of the actual read dependencies, for gateway tracking. */
  read_database_ids?: string[];
  /**
   * The version every user table the statement read was at, keyed by table id.
   *
   * This is the version a client must send back as `baseVersions` for a write
   * derived from these rows: the rows and the version then come from the same
   * read, so a compare-and-swap actually guards what the user saw.
   */
  read_versions: Record<string, number>;
  /** Magic tables whose materialization hit its row cap. */
  truncated_tables: string[];
}

/** Body of `POST /databases/exec`. */
export interface ExecRequest {
  sql: string;
  /**
   * Compare-and-swap: reject writes if any listed table has moved past the
   * given version. Omitted → cell-level last-write-wins.
   */
  baseVersions?: Record<string, number>;
}

/** How a new column obtains its property definition. */
export type ColumnBindingRequest =
  | {
      kind: 'new';
      name: string;
      // The enum carries `rename_all = "camelCase"` (variant names only), so
      // the variant's own fields stay snake_case on the wire.
      data_type: DataType;
      is_multi_select: boolean;
      /**
       * Initial option labels, for the select data types.
       *
       * Select columns store the option's display label in SQL and the
       * materialization CHECKs writes against the option list, so a select
       * column created without options can only ever hold `NULL`.
       */
      options?: string[];
    }
  | { kind: 'existing'; property_definition_id: string };

/** Body of `POST /databases/{id}/tables/{tableId}/columns`. */
export interface CreateColumnRequest {
  infer_type?: boolean;
  binding: ColumnBindingRequest;
  linkToTableId?: string;
  linkToDatabaseId?: string;
}

/** Response of the column route. */
export interface CreateColumnResponse {
  columnId: string;
}

export interface InferColumnTypeRequest {
  data_type: 'STRING' | 'NUMBER' | 'ENTITY';
  specific_entity_type?: EntityType;
  base_version: number;
}

export interface InferColumnTypeOutcome {
  column: DatabaseColumnDetail;
  table_version: number;
}

/**
 * Body of `POST /databases/{id}/tables/{tableId}/columns/{columnId}/options`.
 *
 * Labels that already exist are a no-op, so the same call is safe to repeat.
 */
export interface AddColumnOptionsRequest {
  labels: string[];
}

const dssHost = SERVER_HOSTS['document-storage-service'];

/**
 * Local twin of `dssFetch`. Declared here rather than imported from
 * `./client` so the databases module stays a leaf — `client.ts` re-exports
 * this namespace, and importing back out of it would close an import cycle.
 */
function databasesFetch<
  T extends ObjectLike,
  CustomErrorCode extends string = never,
>(
  path: string,
  init?: FetchWithTokenInit<CustomErrorCode>
): Promise<
  Result<T, ResultError<FetchWithTokenErrorCode | CustomErrorCode>[]>
> {
  return fetchWithToken<T, CustomErrorCode>(`${dssHost}${path}`, init);
}

/**
 * Why `POST /databases/exec` refused a statement, mirroring the status codes
 * `QueryError` maps to. The message is the service's `ErrorResponse.message`:
 * for `SQL_ERROR` that is SQLite's own message, verbatim.
 */
export type ExecErrorCode =
  | 'SQL_ERROR'
  | 'READ_ONLY'
  | 'VERSION_CONFLICT'
  | 'BUDGET_EXCEEDED';

/** The JSON body every `/databases/**` route returns on failure. */
interface ErrorResponse {
  message: string;
}

/**
 * Pull the human-readable reason out of a failed `/databases/**` response.
 *
 * The routes answer with `ErrorResponse` JSON; the raw body is the fallback so
 * a proxy's plain-text error (or a body that is not JSON at all) still reaches
 * the user instead of being swallowed.
 */
function errorMessageFromBody(body: string, status: number): string {
  if (body) {
    try {
      const parsed: unknown = JSON.parse(body);
      const message = (parsed as ErrorResponse | null)?.message;
      if (typeof message === 'string' && message) return message;
    } catch {
      // Not JSON — the raw body is the best message available.
    }
    return body;
  }
  return `HTTP error! status: ${status}`;
}

async function execErrorResponseHandler(
  response: Response
): Promise<ResultError<FetchWithTokenErrorCode | ExecErrorCode>> {
  const message = errorMessageFromBody(await response.text(), response.status);
  switch (response.status) {
    case 400:
      return { code: 'SQL_ERROR', message };
    case 403:
      return { code: 'READ_ONLY', message };
    case 409:
      return { code: 'VERSION_CONFLICT', message };
    case 422:
      return { code: 'BUDGET_EXCEEDED', message };
    default:
      return { code: 'HTTP_ERROR', message };
  }
}

export const databasesClient = {
  /** Read-only execution, enforced by the server. Safe for live document queries. */
  async query(request: { sql: string }) {
    return await databasesFetch<ExecOutcome, ExecErrorCode>(
      '/databases/query',
      {
        method: 'POST',
        body: JSON.stringify(request),
        errorResponseHandler: execErrorResponseHandler,
      }
    );
  },

  async list() {
    return await databasesFetch<ListedDatabase[]>('/databases');
  },

  async get({ id }: { id: string }) {
    return await databasesFetch<DatabaseDetail>(`/databases/${id}`);
  },

  async create({ name }: { name: string }) {
    return await databasesFetch<DatabaseSummary>('/databases', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async createTable({ id, name }: { id: string; name: string }) {
    return await databasesFetch<DatabaseTable>(`/databases/${id}/tables`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
  },

  async renameTable(params: {
    id: string;
    tableId: string;
    name: string;
    previousName: string;
  }) {
    return await databasesFetch<DatabaseTable>(
      `/databases/${params.id}/tables/${params.tableId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: params.name,
          previousName: params.previousName,
        }),
      }
    );
  },

  async createColumn({
    id,
    tableId,
    request,
  }: {
    id: string;
    tableId: string;
    request: CreateColumnRequest;
  }) {
    return await databasesFetch<CreateColumnResponse>(
      `/databases/${id}/tables/${tableId}/columns`,
      { method: 'POST', body: JSON.stringify(request) }
    );
  },

  async renameColumn(params: {
    id: string;
    tableId: string;
    columnId: string;
    name: string;
    previousName: string;
  }) {
    return await databasesFetch<RenameColumnOutcome, 'INVALID_SCHEMA'>(
      `/databases/${params.id}/tables/${params.tableId}/columns/${params.columnId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: params.name,
          previousName: params.previousName,
        }),
        errorResponseHandler: async (response) => ({
          code: response.status === 400 ? 'INVALID_SCHEMA' : 'HTTP_ERROR',
          message: errorMessageFromBody(await response.text(), response.status),
        }),
      }
    );
  },

  async inferColumnType(params: {
    id: string;
    tableId: string;
    columnId: string;
    request: InferColumnTypeRequest;
  }) {
    return await databasesFetch<
      InferColumnTypeOutcome,
      'VERSION_CONFLICT' | 'INVALID_SCHEMA'
    >(
      `/databases/${params.id}/tables/${params.tableId}/columns/${params.columnId}/infer-type`,
      {
        method: 'POST',
        body: JSON.stringify(params.request),
        errorResponseHandler: async (response) => ({
          code:
            response.status === 409
              ? 'VERSION_CONFLICT'
              : response.status === 400
                ? 'INVALID_SCHEMA'
                : 'HTTP_ERROR',
          message: errorMessageFromBody(await response.text(), response.status),
        }),
      }
    );
  },

  /**
   * Add select options to an existing column.
   *
   * Answers with the column as it now stands, so the caller can fold the new
   * labels straight into the cached schema.
   */
  async addColumnOptions({
    id,
    tableId,
    columnId,
    request,
  }: {
    id: string;
    tableId: string;
    columnId: string;
    request: AddColumnOptionsRequest;
  }) {
    return await databasesFetch<DatabaseColumnDetail>(
      `/databases/${id}/tables/${tableId}/columns/${columnId}/options`,
      { method: 'POST', body: JSON.stringify(request) }
    );
  },

  /**
   * Run SQL as the caller. Reads and writes both go through here — there are
   * no row CRUD endpoints.
   */
  async exec(request: ExecRequest) {
    return await databasesFetch<ExecOutcome, ExecErrorCode>('/databases/exec', {
      method: 'POST',
      body: JSON.stringify(request),
      errorResponseHandler: execErrorResponseHandler,
    });
  },

  /**
   * Fetch the SQLite snapshot of a database.
   *
   * Not routed through `dssFetch`: `safeFetch` parses every non-text,
   * non-octet-stream response as JSON, and the snapshot comes back as
   * `application/vnd.sqlite3`.
   */
  async downloadSqlite({ id }: { id: string }): Promise<Blob> {
    const url = `${dssHost}/databases/${id}/sqlite`;
    if (ENABLE_BEARER_TOKEN_AUTH) {
      const apiToken = await getMacroApiToken();
      if (!apiToken) throw new Error('No Macro API token');
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiToken}` },
      });
      if (!response.ok) {
        throw new Error(`Snapshot download failed (${response.status})`);
      }
      return await response.blob();
    }

    await fetchToken();
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Snapshot download failed (${response.status})`);
    }
    return await response.blob();
  },
};
