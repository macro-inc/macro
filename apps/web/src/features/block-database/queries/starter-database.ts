import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabases } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { useDatabasesQuery } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import { queryOptions, useQuery } from '@tanstack/solid-query';
import type { DatabaseViewSelection } from '../../database/core/view-selection';

function starterDatabaseQueryOptions(
  ownerId: string | undefined,
  enabled: boolean
) {
  return queryOptions({
    queryKey: databasesKeys.starter(ownerId ?? '').queryKey,
    enabled: !!ownerId && enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async ({ client }) => {
      const result = await throwOnErr(() =>
        storageServiceClient.databases.ensureStarter()
      );
      // First open demonstrates that Table and Board show the same three ideas.
      // Never overwrite an existing preference after retries or other sessions.
      if (
        result.created &&
        result.databaseId &&
        result.tableId &&
        result.viewId &&
        ownerId
      ) {
        const storage = createUserScopedStorage(
          `database-view-selection:${result.databaseId}`
        );
        if (!storage.read(ownerId)) {
          storage.write(
            ownerId,
            JSON.stringify({
              tableId: result.tableId,
              views: { [result.tableId]: result.viewId },
            } satisfies DatabaseViewSelection)
          );
        }
      }
      if (result.databaseId)
        await client.invalidateQueries({
          queryKey: databasesKeys.list.queryKey,
        });
      return result;
    },
  });
}

/** Mounted inside authenticated app chrome. Provisioning never suspends the app. */
export function useStarterDatabase() {
  const userId = useUserId();
  const flag = useFeatureFlag(enableDatabases);
  const databases = useDatabasesQuery();
  return useQuery(() =>
    starterDatabaseQueryOptions(
      userId(),
      !flag().loading &&
        flag().enabled &&
        databases.isSuccess &&
        databases.data?.length === 0
    )
  );
}
