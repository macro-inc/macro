import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import {
  ReportTaskDocument,
  type ReportTaskQuery,
  type TimeSummaryTaskFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import type { Accessor } from 'solid-js';

/** A task as a time summary carries it. */
export type SummaryTask = TimeSummaryTaskFieldsFragment;

function taskOf(data: ReportTaskQuery): SummaryTask | undefined {
  const entity = data.user.soupEntity;
  return entity?.__typename === 'GraphqlSoupDocument' ? entity : undefined;
}

/**
 * One task in the shape a summary carries it, from the cache's record of the
 * task when it holds those fields and from the server once otherwise. Live
 * like any cached read: a status changed elsewhere shows here too.
 */
export function createReportTaskQuery(
  taskId: Accessor<string | undefined>,
  client: Accessor<Client>
): Accessor<SummaryTask | undefined> {
  const query = createLiveQuery(
    ReportTaskDocument,
    () => {
      const id = taskId();
      return id
        ? { input: { entityType: 'DOCUMENT' as const, entityId: id } }
        : undefined;
    },
    () => ({ client: client(), select: taskOf })
  );
  return () => (query.isPending ? undefined : query.data);
}
