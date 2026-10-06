import { invalidateDatabase } from '@queries/storage/databases';
import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import { useEntitySubscription } from '@service-connection/client';

/**
 * Related tables can live outside the open database; retain their gateway
 * subscription too, and catch up on what it missed while nobody tracked it.
 */
export function useRelatedDatabaseSync(
  databaseId: string,
  refreshRows: () => void
) {
  useDatabaseTableChangedSync(() => databaseId);
  useEntitySubscription(
    () => ({ entity_type: 'database', entity_id: databaseId }),
    () => {
      void invalidateDatabase(databaseId);
      refreshRows();
    }
  );
}
