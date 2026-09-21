import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import {
  MyActivityOverviewDocument,
  type MyActivityOverviewQuery,
  type MyActivityOverviewQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { type Accessor, createMemo, onCleanup } from 'solid-js';
import { registerActivityRevalidator } from '../../../lib/queries/activity/push-registry';
import type { ActivityContext } from '../context/activity-context';
import type { ActivityOverview } from '../core/event';
import { decodeActivityOverview } from './decode';

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function createMyActivityOverviewQuery(
  context: Pick<ActivityContext, 'graphql'>,
  options: { enabled: Accessor<boolean> }
) {
  const client = createMemo(context.graphql);
  const result = createUrqlQuery<
    MyActivityOverviewQuery,
    MyActivityOverviewQueryVariables,
    ActivityOverview
  >(() => ({
    query: MyActivityOverviewDocument,
    client: client(),
    variables: {
      input: { timeZone: browserTimeZone() },
    },
    enabled: options.enabled(),
    requestPolicy: 'cache-and-network',
    keepPreviousData: true,
    select: (data) => decodeActivityOverview(data.user.activityOverview),
  }));
  onCleanup(
    registerActivityRevalidator({
      client,
      refresh: () => {
        if (options.enabled())
          return result.refetch({ requestPolicy: 'network-only' });
      },
    })
  );
  return result;
}
