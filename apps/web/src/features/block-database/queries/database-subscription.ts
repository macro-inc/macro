import { fireAndForget } from '@core/util/fireAndForget';
import { useEntitySubscription } from '@queries/connection/tracked-entities';
import { invalidateDatabase } from '@queries/storage/databases';

/**
 * Share gateway tracking and catch up on subscription, reconnect and refocus.
 * Live write notifications reach the source through useDatabaseTableChanges.
 */
export function useDatabaseSubscription(
  databaseId: string,
  refreshRows: () => void
) {
  useEntitySubscription(
    () => ({ entity_type: 'database', entity_id: databaseId }),
    () => {
      fireAndForget(invalidateDatabase(databaseId), 'database-cache');
      refreshRows();
    }
  );
}
