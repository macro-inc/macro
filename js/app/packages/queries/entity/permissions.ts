import { catchToResult, type ResultError, throwOnErr } from '@core/util/result';
import { dssFetch } from '@service-storage/client';
import type { EntityPermissionResponse } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
import type { Result } from 'neverthrow';
import type { Accessor } from 'solid-js';
import { queryClient } from '../client';
import { entityKeys } from './keys';

function entityPermissionsQueryOptions(entityType: string, entityId: string) {
  return {
    queryKey: entityKeys.permissions(entityType, entityId).queryKey,
    queryFn: async () =>
      await throwOnErr(
        async () =>
          await dssFetch<EntityPermissionResponse>(
            `/entity/${entityType}/${entityId}/permissions`
          )
      ),
  };
}

export function useEntityPermissions(
  entityType: Accessor<string>,
  entityId: Accessor<string>
) {
  return useQuery(() =>
    entityPermissionsQueryOptions(entityType(), entityId())
  );
}

async function _fetchEntityPermissions(
  entityType: string,
  entityId: string
): Promise<Result<EntityPermissionResponse, ResultError<string>[]>> {
  return await catchToResult(
    async () =>
      await queryClient.ensureQueryData(
        entityPermissionsQueryOptions(entityType, entityId)
      )
  );
}
