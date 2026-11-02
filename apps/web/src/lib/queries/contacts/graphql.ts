import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { Telemetry } from '@macro-inc/observability';
import {
  ContactsDocument,
  type ContactsQuery,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import { createRequest, type RequestPolicy } from '@urql/core';
import type { Accessor } from 'solid-js';
import { createTrailingRefetch } from '../trailing-refetch';

function selectContacts(data: ContactsQuery) {
  // GraphQL errors can carry partial data even for a non-null catalog field.
  const contacts = data.user?.contacts;
  if (!Array.isArray(contacts))
    throw new Error('Contacts read returned no catalog');
  return { contacts };
}

/** One viewer-scoped catalog shared by startup hydration and contact pickers. */
export function createGraphqlContactsQuery(enabled: Accessor<boolean>) {
  return createLiveQuery(
    ContactsDocument,
    () => ({}),
    () => ({
      enabled: enabled(),
      client: getGraphqlSoupClient(),
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: selectContacts,
    })
  );
}

/** Read the persistent catalog directly, or refresh its server-owned membership. */
export function fetchGraphqlContacts(
  requestPolicy: RequestPolicy = 'cache-first'
) {
  return Telemetry.span('contacts.load', async (span) => {
    const client = getGraphqlSoupClient();
    const operation = client.createRequestOperation(
      'query',
      createRequest(ContactsDocument, {}),
      { requestPolicy }
    );
    const fetch = operation.context.fetch;
    const result = await client
      .executeRequestOperation({
        ...operation,
        context: {
          ...operation.context,
          ...(fetch && {
            fetch: (input: RequestInfo | URL, init?: RequestInit) =>
              span.run(() => fetch(input, init)),
          }),
        },
      })
      .toPromise();
    if (result.error || !result.data) {
      span.error('Contacts read failed');
      throw result.error ?? new Error('Contacts read returned no data');
    }
    const metadata = normalizedCacheResultMetadata(result);
    if (metadata?.source === 'live-network') await metadata.persistence;
    span.setAttr('contacts.count', result.data.user.contacts.length);
    return selectContacts(result.data);
  });
}

const REFRESHES = new WeakMap<
  ReturnType<typeof getGraphqlSoupClient>,
  () => Promise<void>
>();

/** Invalidations refresh disk even without a mounted picker, with a trailing read for races. */
export function refreshGraphqlContacts(): Promise<void> {
  const client = getGraphqlSoupClient();
  let refresh = REFRESHES.get(client);
  if (!refresh) {
    refresh = createTrailingRefetch(
      () => getGraphqlSoupClient() === client,
      () => fetchGraphqlContacts('network-only')
    );
    REFRESHES.set(client, refresh);
  }
  return refresh();
}
