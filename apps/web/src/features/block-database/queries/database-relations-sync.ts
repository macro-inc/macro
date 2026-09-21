import {
  invalidateDatabase,
  invalidateDatabaseRows,
} from '@queries/storage/databases';
import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import { useEntitySubscription } from '@service-connection/client';
import type { Accessor } from 'solid-js';

/** Related tables can live outside the open database; retain their gateway subscription too. */
export function useRelatedDatabaseSync(
  databaseId: string,
  tableIds: Accessor<string[]>
) {
  useDatabaseTableChangedSync(() => databaseId);
  useEntitySubscription(
    () => ({ entity_type: 'database', entity_id: databaseId }),
    () => {
      void invalidateDatabase(databaseId);
      for (const tableId of tableIds())
        void invalidateDatabaseRows(databaseId, tableId);
    }
  );
}
