import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  TaskDependenciesDocument,
  TaskDependencyStatesDocument,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { type Accessor, createMemo, indexArray } from 'solid-js';
import { validate as validateUuid } from 'uuid';

/** Task detail reads share the normalized dependency record used by list rows. */
export function createTaskDependencyQuery(taskId: Accessor<string>) {
  return createLiveQuery(
    TaskDependenciesDocument,
    () =>
      taskId()
        ? {
            input: { entityType: 'DOCUMENT' as const, entityId: taskId() },
          }
        : undefined,
    () => ({
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: (data) => {
        const entity = data.user.soupEntity;
        return entity?.__typename === 'GraphqlSoupDocument' ? entity : null;
      },
    })
  );
}

/** Search pages hydrate facts in bounded batches, not one request per task row. */
export function createTaskDependencyStatesSource(
  taskIds: Accessor<readonly string[]>
) {
  const chunks = createMemo(() => {
    const ids = [...new Set(taskIds().filter(validateUuid))].sort();
    const chunks: string[][] = [];
    for (let index = 0; index < ids.length; index += 500)
      chunks.push(ids.slice(index, index + 500));
    return chunks;
  });
  const queries = indexArray(chunks, (ids) =>
    createLiveQuery(
      TaskDependencyStatesDocument,
      () => ({ taskIds: ids() }),
      () => ({
        client: getGraphqlSoupClient(),
        requestPolicy: 'cache-and-network',
        keepPreviousData: false,
      })
    )
  );
  const states = createMemo(
    () =>
      new Map(
        queries().flatMap((query) =>
          (query.data?.user.taskDependencyStates ?? []).map(
            (state) => [state.id, state] as const
          )
        )
      )
  );
  return {
    states,
    error: () => queries().find((query) => query.error)?.error,
  };
}
