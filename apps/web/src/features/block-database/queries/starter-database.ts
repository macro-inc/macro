import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableDatabases } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/result';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { useDatabasesQuery } from '@queries/storage/databases';
import { databasesKeys } from '@queries/storage/keys';
import { storageServiceClient } from '@service-storage/client';
import { useQuery, useQueryClient } from '@tanstack/solid-query';
import { databaseViewKeys } from './keys';

/** Mounted inside authenticated app chrome. Provisioning never suspends the app. */
export function useStarterDatabase() {
  const userId = useUserId();
  const flag = useFeatureFlag(enableDatabases);
  const databases = useDatabasesQuery();
  const client = useQueryClient();
  return useQuery(() => ({
    queryKey: databasesKeys.starter(userId() ?? '').queryKey,
    enabled:
      !!userId() &&
      !flag().loading &&
      flag().enabled &&
      databases.isSuccess &&
      databases.data?.length === 0,
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async () => {
      const ownerId = userId();
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
              drafts: {},
            })
          );
        }
      }
      if (result.databaseId) {
        await Promise.all([
          client.invalidateQueries({ queryKey: databasesKeys.list.queryKey }),
          client.invalidateQueries({
            queryKey: databaseViewKeys.saved.queryKey,
          }),
        ]);
      }
      return result;
    },
  }));
}
