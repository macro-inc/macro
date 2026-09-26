import { registerActivityRevalidator } from '@queries/activity/push-registry';
import type { Client } from '@urql/core';
import { type Accessor, onCleanup } from 'solid-js';

export type ProjectTaskRefreshSource = {
  projectId: Accessor<string>;
  taskIds: Accessor<readonly string[]>;
  refresh(): Promise<void>;
};

/** Refresh only this project's mounted task hydration when its entities change. */
export function observeProjectTaskChanges(
  client: Accessor<Client | undefined>,
  source: ProjectTaskRefreshSource
) {
  onCleanup(
    registerActivityRevalidator({
      client,
      refresh: (entities) => {
        const ids = source.taskIds();
        if (!ids.length) return;
        if (
          entities === null ||
          entities.has(source.projectId()) ||
          ids.some((id) => entities.has(id))
        )
          return source.refresh();
      },
    })
  );
}
