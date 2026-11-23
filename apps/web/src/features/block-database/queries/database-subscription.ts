import { fireAndForget } from '@core/util/fireAndForget';
import { invalidateDatabase } from '@queries/storage/databases';
import { useEntitySubscription } from '@service-connection/client';

/**
 * How a grid's host read the schema: `opened` read it as the database opened,
 * just before tracking began; `cached` may show a copy read before then.
 */
export type DatabaseSchemaSource = 'opened' | 'cached';

/**
 * Share gateway tracking and catch up on subscription, reconnect and refocus.
 * Live write notifications reach the source through useDatabaseTableChanges.
 */
export function useDatabaseSubscription(
  databaseId: string,
  refreshRows: () => void,
  schema: DatabaseSchemaSource
) {
  useEntitySubscription(
    () => ({ entity_type: 'database', entity_id: databaseId }),
    (_entity, reason) => {
      if (reason !== 'subscribed' || schema === 'cached')
        fireAndForget(invalidateDatabase(databaseId), 'database-cache');
      refreshRows();
    }
  );
}
