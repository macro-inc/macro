import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import {
  DatabaseActivityDocument,
  type DatabaseActivityQuery,
  type DatabaseActivityQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import { registerActivityRevalidator } from '../../../lib/queries/activity/push-registry';
import type { ActivityContext } from '../context/activity-context';
import { decodeActivityEvent } from './decode';
import { ENTITY_ACTIVITY_PREVIEW_LIMIT } from './entity-query';
import type { EntityActivityResult } from './select-entity-activity';

type DatabaseActivityQueryOptions = {
  databaseId: Accessor<string>;
  enabled: Accessor<boolean>;
  limit?: number;
};

/**
 * Live urql query for one database's recent activity, newest first.
 * Databases are not Soup items, so they are read by id through
 * `databaseActivity`, which checks view access; the result has the same
 * shape as a Soup entity's so the panel renders both the same way.
 */
export function createDatabaseActivityQuery(
  context: Pick<ActivityContext, 'graphql'>,
  options: DatabaseActivityQueryOptions
) {
  const databaseId = createMemo(() => {
    const id = options.databaseId();
    return options.enabled() && id.length > 0 ? id : undefined;
  });

  const client = createMemo(context.graphql);
  const result = createUrqlQuery<
    DatabaseActivityQuery,
    DatabaseActivityQueryVariables,
    EntityActivityResult
  >(() => ({
    query: DatabaseActivityDocument,
    client: client(),
    variables: {
      databaseId: databaseId() ?? '',
      limit: options.limit ?? ENTITY_ACTIVITY_PREVIEW_LIMIT,
    },
    enabled: databaseId() !== undefined,
    requestPolicy: 'cache-and-network',
    keepPreviousData: false,
    select: (data) => ({
      kind: 'found',
      events: data.user.databaseActivity.map(decodeActivityEvent),
    }),
  }));

  onCleanup(
    registerActivityRevalidator({
      client,
      refresh: (entities) => {
        const id = databaseId();
        if (id === undefined || (entities !== null && !entities.has(id)))
          return;
        return result.refetch({ requestPolicy: 'network-only' });
      },
    })
  );

  return {
    result,
    isEnabled: () => databaseId() !== undefined,
  };
}
