import {
  catchToResult,
  type MaybeResult,
  throwOnErr,
} from '@core/util/maybeResult';
import { dssFetch } from '@service-storage/client';
import type { EntityPermissionResponse } from '@service-storage/generated/schemas';
import { useQuery } from '@tanstack/solid-query';
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

export async function fetchEntityPermissions(
  entityType: string,
  entityId: string
): Promise<MaybeResult<string, EntityPermissionResponse>> {
  return await catchToResult(
    async () =>
      await queryClient.ensureQueryData(
        entityPermissionsQueryOptions(entityType, entityId)
      )
  );
}
