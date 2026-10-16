import { useDatabaseTableChangedSync } from '@queries/storage/databases-sync';
import { useDatabaseSubscription } from './database-subscription';

/**
 * Related tables can live outside the open database; retain their gateway
 * subscription too, and catch up on what it missed while nobody tracked it.
 */
export function useRelatedDatabaseSync(
  databaseId: string,
  refreshRows: () => void
) {
  useDatabaseTableChangedSync(() => databaseId);
  useDatabaseSubscription(databaseId, refreshRows);
}
