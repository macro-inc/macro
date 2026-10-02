/** The `/databases` routes of `crates/databases`, mounted by the document storage service. */
import { SERVER_HOSTS } from '@core/constant/servers';
import type {
  CellValue,
  DatabaseOp,
  OpColumnKind,
} from '@core/database-sql/generated/types';
import {
  type FetchWithTokenErrorCode,
  type FetchWithTokenInit,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import { statusError } from '@core/util/safeFetch';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { ApplyOpsResponse } from './generated/schemas/applyOpsResponse';
import type { Awareness } from './generated/schemas/awareness';
import type { ColumnCast } from './generated/schemas/columnCast';
import type { ColumnConversion } from './generated/schemas/columnConversion';
import type { CreateDatabaseRequest } from './generated/schemas/createDatabaseRequest';
import type { Database } from './generated/schemas/database';
import type { DatabaseDetail } from './generated/schemas/databaseDetail';
import type { DatabaseTemplate } from './generated/schemas/databaseTemplate';
import type { ErrorResponse } from './generated/schemas/errorResponse';
import type { ImportTable } from './generated/schemas/importTable';
import type { InferColumnTypeOutcome } from './generated/schemas/inferColumnTypeOutcome';
import type { InferColumnTypeRequest } from './generated/schemas/inferColumnTypeRequest';
import type { ListedDatabase } from './generated/schemas/listedDatabase';
import type { OpRefusalResponse } from './generated/schemas/opRefusalResponse';
import type { SharePermissionV2 } from './generated/schemas/sharePermissionV2';
import type { StarterDatabase } from './generated/schemas/starterDatabase';
import type { Table } from './generated/schemas/table';
import type { TableChanges } from './generated/schemas/tableChanges';
import type { TakenId } from './generated/schemas/takenId';
import type { UndoChangeResponse } from './generated/schemas/undoChangeResponse';
import type { UpdateSharePermissionRequestV2 } from './generated/schemas/updateSharePermissionRequestV2';
import type { ViewPositionsResponse } from './generated/schemas/viewPositionsResponse';

/** A schema change the service refused as invalid (400), e.g. a taken name. */
export type DatabaseSchemaErrorCode =
  | FetchWithTokenErrorCode
  | 'INVALID_SCHEMA';

/** A batch of `/ops` the service refused (400); nothing of it was written. */
type DatabaseOpsErrorCode = FetchWithTokenErrorCode | 'INVALID_OP';

/** An `/ops` failure; an `INVALID_OP` names the op, row, column and taken id it refused. */
export type DatabaseOpsError = ResultError<DatabaseOpsErrorCode> & {
  refusal: OpRefusalResponse | null;
};

/** A {@link ColumnConversion} whose cells are the engine's own values, ready for a rows `update` op. */
export type DatabaseColumnConversion = Omit<ColumnConversion, 'cells'> & {
  cells: { row: string; value: CellValue }[];
};

const documentStorageHost = SERVER_HOSTS['document-storage-service'];

function isErrorResponse(body: unknown): body is ErrorResponse {
  return (
    !!body &&
    typeof body === 'object' &&
    'message' in body &&
    typeof body.message === 'string'
  );
}

function takenIdOf(taken: unknown): TakenId | null {
  if (
    !taken ||
    typeof taken !== 'object' ||
    !('id' in taken) ||
    typeof taken.id !== 'string' ||
    !('kind' in taken)
  )
    return null;
  const id = taken.id;
  return match(taken.kind)
    .returnType<TakenId | null>()
    .with('table', 'column', 'option', 'view', (kind) => ({ kind, id }))
    .otherwise(() => null);
}

/** The op, row, column and taken id a 400 from `/ops` names, when its body is a refusal. */
function opRefusalOf(body: unknown): OpRefusalResponse | null {
  if (!isErrorResponse(body) || !('op' in body) || typeof body.op !== 'number')
    return null;
  const row = 'row' in body ? body.row : null;
  const column = 'column' in body ? body.column : null;
  return {
    message: body.message,
    op: body.op,
    row: typeof row === 'number' ? row : null,
    column: typeof column === 'string' ? column : null,
    taken: takenIdOf('taken' in body ? body.taken : null),
  };
}

/** A failed response's body, and the message it gives. */
export async function errorBody(
  response: Response
): Promise<{ body: unknown; message: string }> {
  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    // A proxy's plain-text body is the message.
  }
  return {
    body,
    message:
      isErrorResponse(body) && body.message
        ? body.message
        : text || `HTTP error! status: ${response.status}`,
  };
}

/** A 400 is the route's own refusal, `invalid`; any other status keeps safeFetch's code. */
function statusCode<Invalid extends string>(
  status: number,
  invalid: Invalid | undefined
): FetchWithTokenErrorCode | Invalid {
  return status === 400 && invalid !== undefined
    ? invalid
    : statusError(status).code;
}

/** One `/databases` request; a failure carries the service's own message. */
function databasesFetch<T extends ObjectLike, Invalid extends string = never>(
  path: string,
  init: Omit<FetchWithTokenInit, 'errorResponseHandler'> & {
    invalid?: Invalid;
  } = {}
): ResultAsync<T, ResultError<FetchWithTokenErrorCode | Invalid>[]> {
  const { invalid, ...request } = init;
  return new ResultAsync(
    fetchWithToken<T, Invalid>(`${documentStorageHost}${path}`, {
      ...request,
      errorResponseHandler: async (response) => ({
        code: statusCode(response.status, invalid),
        message: (await errorBody(response)).message,
      }),
    })
  );
}

/** The refusal the `/ops` error handler attached; transport failures (a 401) carry none. */
function withRefusal(
  error: ResultError<DatabaseOpsErrorCode>
): DatabaseOpsError {
  return {
    ...error,
    refusal: 'refusal' in error ? opRefusalOf(error.refusal) : null,
  };
}

export const databasesClient = {
  importTable({ id, request }: { id: string; request: ImportTable }) {
    return databasesFetch<Table, 'INVALID_SCHEMA'>(`/databases/${id}/import`, {
      method: 'POST',
      body: JSON.stringify(request),
      invalid: 'INVALID_SCHEMA',
    });
  },

  getPermissions({ id }: { id: string }) {
    return databasesFetch<SharePermissionV2>(`/databases/${id}/permissions`);
  },

  updatePermissions({
    id,
    ...request
  }: { id: string } & UpdateSharePermissionRequestV2) {
    return databasesFetch<SharePermissionV2, 'INVALID_SHARING'>(
      `/databases/${id}/permissions`,
      {
        method: 'PATCH',
        body: JSON.stringify(request),
        invalid: 'INVALID_SHARING',
      }
    );
  },

  list() {
    return databasesFetch<ListedDatabase[]>('/databases');
  },

  /** The templates a new database can start from, in picker order. */
  templates() {
    return databasesFetch<DatabaseTemplate[]>('/databases/templates');
  },

  ensureStarter() {
    return databasesFetch<StarterDatabase>('/databases/starter', {
      method: 'POST',
    });
  },

  get({ id }: { id: string }) {
    return databasesFetch<DatabaseDetail>(`/databases/${id}`);
  },

  create(request: CreateDatabaseRequest) {
    return databasesFetch<Database, 'INVALID_SCHEMA'>('/databases', {
      method: 'POST',
      body: JSON.stringify(request),
      invalid: 'INVALID_SCHEMA',
    });
  },

  /** The dry run of a type change: what each menu type does to the values. */
  columnCasts(params: { id: string; tableId: string; columnId: string }) {
    return databasesFetch<ColumnCast[]>(
      `/databases/${params.id}/tables/${params.tableId}/columns/${params.columnId}/casts`
    );
  },

  /**
   * What a column's values become under `to`, for a new column of that type
   * beside it; nothing changes. A type no value converts to is refused (400)
   * with the cast's reason.
   */
  convertColumn(params: {
    id: string;
    tableId: string;
    columnId: string;
    to: OpColumnKind;
  }): ResultAsync<DatabaseColumnConversion, DatabaseOpsError[]> {
    return databasesFetch<DatabaseColumnConversion, 'INVALID_OP'>(
      `/databases/${params.id}/tables/${params.tableId}/columns/${params.columnId}/conversion`,
      {
        method: 'POST',
        body: JSON.stringify({ to: params.to }),
        invalid: 'INVALID_OP',
      }
    ).mapErr((errors) => errors.map((error) => ({ ...error, refusal: null })));
  },

  inferColumnType(params: {
    id: string;
    tableId: string;
    columnId: string;
    request: InferColumnTypeRequest;
  }) {
    return databasesFetch<InferColumnTypeOutcome, 'INVALID_SCHEMA'>(
      `/databases/${params.id}/tables/${params.tableId}/columns/${params.columnId}/infer-type`,
      {
        method: 'POST',
        body: JSON.stringify(params.request),
        invalid: 'INVALID_SCHEMA',
      }
    );
  },

  /**
   * Apply a batch of the engine's typed ops to a database, together or not at
   * all. `baseVersions` names the version each table must still be at; a
   * table that moved refuses the batch as a `CONFLICT`. A refusal naming an
   * id already `taken` means an earlier attempt of this batch committed, or
   * an id was minted twice.
   */
  applyOps({
    id,
    request,
  }: {
    id: string;
    /** The engine's ops: the generated `ApplyOpsRequest` drops `null` from optional fields. */
    request: { ops: DatabaseOp[]; baseVersions?: Record<string, number> };
  }): ResultAsync<ApplyOpsResponse, DatabaseOpsError[]> {
    return new ResultAsync(
      fetchWithToken<ApplyOpsResponse, 'INVALID_OP'>(
        `${documentStorageHost}/databases/${id}/ops`,
        {
          method: 'POST',
          body: JSON.stringify(request),
          errorResponseHandler: async (response): Promise<DatabaseOpsError> => {
            const { body, message } = await errorBody(response);
            const code = statusCode(response.status, 'INVALID_OP');
            return {
              code,
              message,
              refusal: code === 'INVALID_OP' ? opRefusalOf(body) : null,
            };
          },
        }
      )
    ).mapErr((errors) => errors.map(withRefusal));
  },

  /**
   * Undo one of the caller's own committed changes, by its journal id from an
   * `/ops` response. Guarded against later edits: the outcome says whether it
   * reverted, partly reverted, or was refused. Undoing the undo's change redoes.
   */
  undoChange({ id, change }: { id: string; change: number }) {
    return databasesFetch<UndoChangeResponse>(
      `/databases/${id}/changes/${change}/undo`,
      { method: 'POST' }
    );
  },

  /** What changed in one table since a version: its rows, each once, and its columns. */
  tableChanges({
    id,
    tableId,
    since,
  }: {
    id: string;
    tableId: string;
    since: number;
  }) {
    return databasesFetch<TableChanges>(
      `/databases/${id}/tables/${tableId}/changes?since=${since}`
    );
  },

  /** Where a board's cards sit: each placed card's lane and key there. */
  viewPositions({ id, viewId }: { id: string; viewId: string }) {
    return databasesFetch<ViewPositionsResponse>(
      `/databases/${id}/views/${viewId}/positions`
    );
  },

  /** Tell the database's other viewers where the caller is. Responds 204. */
  shareAwareness({ id, state }: { id: string; state: Awareness }) {
    return databasesFetch<Record<string, never>>(`/databases/${id}/awareness`, {
      method: 'PUT',
      body: JSON.stringify(state),
    });
  },
};
