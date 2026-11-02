import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useIsAuthenticated } from '@core/context/user';
import type { IUser } from '@core/user/types';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { throwOnErr } from '@core/util/result';
import { queryClient } from '@queries/client';
import { contactsClient } from '@service-contacts/client';
import { useQuery } from '@tanstack/solid-query';
import type { RequestPolicy } from '@urql/core';
import { type Accessor, createMemo } from 'solid-js';
import {
  createGraphqlContactsQuery,
  fetchGraphqlContacts,
  refreshGraphqlContacts,
} from './graphql';
import { contactsKeys } from './keys';

export function contactsQueryOptions() {
  return {
    queryKey: contactsKeys.all.queryKey,
    queryFn: () => throwOnErr(() => contactsClient.getContacts()),
  };
}

/** Imperative readers share the persistent GraphQL catalog when enabled. */
export function fetchContacts(requestPolicy: RequestPolicy = 'cache-first') {
  return isFeatureEnabled(enableGraphqlSoup)
    ? fetchGraphqlContacts(requestPolicy)
    : queryClient.fetchQuery(contactsQueryOptions());
}

/** The normal contacts catalog, with a non-suspending loading state for pickers. */
export function useContactsQuery(enabled: Accessor<boolean> = () => true) {
  const authenticated = useIsAuthenticated();
  const flag = useFeatureFlag(enableGraphqlSoup);
  const graphql = () => flag().enabled;
  const active = () => authenticated() === true && enabled() && !flag().loading;
  const live = createGraphqlContactsQuery(() => active() && graphql());
  const rest = useQuery(() => ({
    ...contactsQueryOptions(),
    enabled: active() && !graphql(),
  }));
  const data = () => {
    if (!active()) return undefined;
    if (graphql()) return live.data;
    return rest.isSuccess ? rest.data : undefined;
  };
  return {
    get data() {
      return data();
    },
    get isPending() {
      return !data() && (graphql() ? live.isPending : rest.isPending);
    },
    get isError() {
      return !data() && (graphql() ? live.isError : rest.isError);
    },
    get isSuccess() {
      return data() !== undefined;
    },
  };
}

/** Returns normal contacts as IUser objects, retaining cached data during refresh failures. */
export function useContacts(
  enabled: Accessor<boolean> = () => true
): Accessor<IUser[]> {
  const query = useContactsQuery(enabled);
  return createMemo(() =>
    (query.data?.contacts ?? []).map((id) => ({
      id,
      email: idToEmail(id),
      name: idToDisplayName(id),
    }))
  );
}

/** Refresh server-owned membership in whichever contacts transport is active. */
export function invalidateContacts() {
  return isFeatureEnabled(enableGraphqlSoup)
    ? refreshGraphqlContacts()
    : queryClient.invalidateQueries(contactsQueryOptions());
}
