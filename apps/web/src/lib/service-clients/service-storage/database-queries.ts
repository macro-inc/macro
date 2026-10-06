/** Saved database queries: immutable SQL rows a document answer points at. */
import { SERVER_HOSTS } from '@core/constant/servers';
import {
  type FetchWithTokenErrorCode,
  fetchWithToken,
} from '@core/util/fetchWithToken';
import type { ObjectLike, ResultError } from '@core/util/result';
import { ResultAsync } from 'neverthrow';
import { match, P } from 'ts-pattern';
import { errorBody } from './databases';
import type { SavedQuery } from './generated/schemas/savedQuery';
import type { SaveQueryRequest } from './generated/schemas/saveQueryRequest';

/**
 * Why a saved query was refused: it is gone or not visible (404), or its SQL
 * is longer than the route stores (422).
 */
export type SavedQueryErrorCode = FetchWithTokenErrorCode | 'QUERY_TOO_LONG';

const documentStorageHost = SERVER_HOSTS['document-storage-service'];

async function errorResponseHandler(
  response: Response
): Promise<ResultError<SavedQueryErrorCode>> {
  return {
    code: match(response.status)
      .returnType<SavedQueryErrorCode>()
      .with(401, () => 'UNAUTHORIZED')
      .with(404, () => 'NOT_FOUND')
      .with(422, () => 'QUERY_TOO_LONG')
      .with(P.number.gte(500), () => 'SERVER_ERROR')
      .otherwise(() => 'HTTP_ERROR'),
    message: (await errorBody(response)).message,
  };
}

function savedQueriesFetch<T extends ObjectLike>(
  path: string,
  init?: RequestInit
): ResultAsync<T, ResultError<SavedQueryErrorCode>[]> {
  return new ResultAsync(
    fetchWithToken<T, SavedQueryErrorCode>(`${documentStorageHost}${path}`, {
      ...init,
      errorResponseHandler,
    })
  );
}

export function saveDatabaseQuery(request: SaveQueryRequest) {
  return savedQueriesFetch<SavedQuery>('/databases/queries', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export function getDatabaseQuery(queryId: string) {
  return savedQueriesFetch<SavedQuery>(
    `/databases/queries/${encodeURIComponent(queryId)}`
  );
}
