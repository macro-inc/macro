import type { QueryCapabilities } from '@app/features/database-query/context/query-context';
import { queryCapabilities } from '@app/features/database-query/queries/app-query-source';
import { queryClient } from '@queries/client';
import { databaseQueryKeys, databasesKeys } from '@queries/storage/keys';
import { databaseViewKeys } from './keys';

/** Only the database editing surface gets write-capable AI. Document answers stay read-only. */
export const databaseAssistantCapabilities: QueryCapabilities = {
  generationCanWrite: true,
  read: queryCapabilities.read,
  async generate(input) {
    const { runDatabaseAssistant } = await import(
      '@service-cognition/database-query'
    );
    try {
      return await runDatabaseAssistant(input);
    } finally {
      // A response can fail after a tool committed. Refresh schema, rows, live
      // answers and personal views even then, without replacing the AI draft.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: databasesKeys._def }),
        queryClient.invalidateQueries({ queryKey: databaseQueryKeys._def }),
        queryClient.invalidateQueries({
          queryKey: databaseViewKeys.saved.queryKey,
        }),
      ]);
    }
  },
};
