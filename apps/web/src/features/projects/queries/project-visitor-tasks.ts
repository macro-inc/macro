import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import type { Property } from '@property/types';
import { InitiativeTasksDocument } from '@service-storage/graphql/generated/graphql';
import { mapGraphqlProperties } from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import type { Accessor } from 'solid-js';
import { taskProperties } from './project-properties';

export type VisitorTask = { id: string; name: string; properties: Property[] };

/**
 * The tasks a project read found visible to the viewer, for a caller with no
 * account: the Tasks list behind a project needs one.
 */
export function createProjectVisitorTasksQuery(
  client: () => Client,
  projectId: Accessor<string>
) {
  return createLiveQuery(
    InitiativeTasksDocument,
    () => ({ initiativeId: projectId() }),
    () => ({
      client: client(),
      requestPolicy: 'network-only',
      select: (data): VisitorTask[] =>
        data.initiative.tasks.map((task) => ({
          id: task.id,
          name: task.displayName ?? '',
          properties: taskProperties(mapGraphqlProperties(task.properties)),
        })),
    })
  );
}
