import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import {
  MyActivityOverviewDocument,
  type MyActivityOverviewQuery,
  type MyActivityOverviewQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import type { Accessor } from 'solid-js';
import type { ActivityOverview } from '../core/event';
import type { ActivityDeps } from '../deps';
import { decodeActivityOverview } from './decode';

export function createMyActivityOverviewQuery(
  deps: Pick<ActivityDeps, 'graphql' | 'timeZone'>,
  options: { enabled: Accessor<boolean> }
) {
  return createUrqlQuery<
    MyActivityOverviewQuery,
    MyActivityOverviewQueryVariables,
    ActivityOverview
  >(() => ({
    query: MyActivityOverviewDocument,
    client: deps.graphql(),
    variables: {
      input: { timeZone: deps.timeZone() },
    },
    enabled: options.enabled(),
    requestPolicy: 'cache-and-network',
    keepPreviousData: true,
    select: (data) => decodeActivityOverview(data.user.activityOverview),
  }));
}
