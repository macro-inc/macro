import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import {
  MyActivityOverviewDocument,
  type MyActivityOverviewQuery,
  type MyActivityOverviewQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Accessor } from 'solid-js';

export type ActivityOverview =
  MyActivityOverviewQuery['user']['activityOverview'];

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function createMyActivityOverviewQuery(options: {
  enabled: Accessor<boolean>;
}) {
  return createUrqlQuery<
    MyActivityOverviewQuery,
    MyActivityOverviewQueryVariables,
    ActivityOverview
  >(() => ({
    query: MyActivityOverviewDocument,
    client: getGraphqlSoupClient(),
    variables: {
      input: { timeZone: browserTimeZone() },
    },
    enabled: options.enabled(),
    requestPolicy: 'cache-and-network',
    keepPreviousData: true,
    select: (data) => data.user.activityOverview,
  }));
}
