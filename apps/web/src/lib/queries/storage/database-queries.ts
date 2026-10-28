/** A saved query never changes, so its definition is cached forever. */
import { type ResultError, throwOnErr } from '@core/util/result';
import {
  getDatabaseQuery,
  type SavedQueryErrorCode,
  saveDatabaseQuery,
} from '@service-storage/database-queries';
import type { SavedQuery } from '@service-storage/generated/schemas/savedQuery';
import type { SaveQueryRequest } from '@service-storage/generated/schemas/saveQueryRequest';
import { useQuery } from '@tanstack/solid-query';
import type { ResultAsync } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { savedDatabaseQueryKeys } from './keys';

/** Save SQL as a new immutable query and seed its definition cache. */
export function createSavedDatabaseQuery(
  request: SaveQueryRequest
): ResultAsync<SavedQuery, ResultError<SavedQueryErrorCode>[]> {
  return saveDatabaseQuery(request).map((saved) => {
    queryClient.setQueryData(
      savedDatabaseQueryKeys.definition(saved.id).queryKey,
      saved
    );
    return saved;
  });
}

/** A saved query's definition; its errors carry the route's codes. */
export function useDatabaseQueryDefinition(queryId: Accessor<string>) {
  return useQuery(() => ({
    queryKey: savedDatabaseQueryKeys.definition(queryId()).queryKey,
    queryFn: () => throwOnErr(() => getDatabaseQuery(queryId())),
    enabled: !!queryId(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  }));
}
