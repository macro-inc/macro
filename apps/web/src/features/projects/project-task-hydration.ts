import { isTaskEntity } from '@entity';
import { buildGraphqlEntitiesSoupInput } from '@queries/soup/graphql/entity-input';
import { mapApiSoupItemToEntity } from '@queries/soup/transform-utils';
import { SoupDocument } from '@service-storage/graphql/generated/graphql';
import { fetchGraphqlSoup } from '@service-storage/graphql-soup';

/** Hydrate current project membership through the same task entity transport as Tasks. */
export async function hydrateProjectTasks(
  taskIds: string[],
  signal: AbortSignal
) {
  const input = buildGraphqlEntitiesSoupInput(
    taskIds.map((entityId) => ({ entityId, entityType: 'TASK' }))
  );
  if (!input) return [];
  const hydrated = await fetchGraphqlSoup(
    SoupDocument,
    { input },
    {
      signal,
      requestPolicy: 'network-only',
      allowOfflineFallback: false,
    }
  );
  signal.throwIfAborted();
  return hydrated.items
    .filter((item) => item.tag === 'document')
    .map(mapApiSoupItemToEntity)
    .filter(isTaskEntity)
    .filter((task) => taskIds.includes(task.id));
}
