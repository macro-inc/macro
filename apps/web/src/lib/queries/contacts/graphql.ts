import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { createLiveQuery } from '@graphql-cache/solid/create-live-query';
import { Telemetry } from '@macro-inc/observability';
import {
  ContactsDocument,
  type ContactsQuery,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import {
  createRequest,
  getOperationName,
  type RequestPolicy,
  stringifyDocument,
} from '@urql/core';
import type { Accessor } from 'solid-js';
import { createTrailingRefetch } from '../trailing-refetch';

const CONTACTS_REQUEST_CONTEXT_KEY = '__macroContactsRequest';

function selectContacts(data: ContactsQuery) {
  // GraphQL errors can carry partial data even for a non-null catalog field.
  const contacts = data.user?.contacts;
  if (!Array.isArray(contacts))
    throw new Error('Contacts read returned no catalog');
  return { contacts };
}

/** Cache RPC data is untyped; retain the generated document's complete shape. */
function parseCachedContacts(data: unknown): ContactsQuery | undefined {
  if (!data || typeof data !== 'object' || !('user' in data)) return;
  const user = data.user;
  if (
    !user ||
    typeof user !== 'object' ||
    !('id' in user) ||
    typeof user.id !== 'string' ||
    !('contacts' in user)
  )
    return;
  const contacts = user.contacts;
  if (
    !Array.isArray(contacts) ||
    !contacts.every((id: unknown): id is string => typeof id === 'string')
  )
    return;
  return { user: { id: user.id, contacts } };
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
    let data: ContactsQuery | undefined;
    if (requestPolicy === 'cache-only' || requestPolicy === 'cache-first') {
      const host = getGraphqlSoupCacheHost();
      if (host && !host.disabled) {
        // Do not join a mounted urql query: its pending network response can
        // delay a local SQL pass even when the complete catalog is on disk.
        const cached = await host.readQuery({
          query: stringifyDocument(ContactsDocument),
          operationName: getOperationName(ContactsDocument),
          variables: {},
        });
        if (host.disabled || getGraphqlSoupCacheHost() !== host)
          throw new Error('Contacts cache replaced');
        if (cached.kind === 'hit') data = parseCachedContacts(cached.data);
      }
      if (!data && requestPolicy === 'cache-only')
        throw new Error('Contacts cache unavailable');
    }
    if (!data) {
      const requestId = Symbol();
      const read = () => {
        const operation = client.createRequestOperation(
          'query',
          createRequest(ContactsDocument, {}),
          { requestPolicy, [CONTACTS_REQUEST_CONTEXT_KEY]: requestId }
        );
        const fetch = operation.context.fetch;
        return client
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
      };
      let result = await read();
      // urql can join a request that began before this invalidation. Let that
      // request finish, then read again so the old snapshot cannot satisfy refresh.
      if (
        requestPolicy === 'network-only' &&
        result.operation.context[CONTACTS_REQUEST_CONTEXT_KEY] !== requestId &&
        getGraphqlSoupClient() === client
      ) {
        result = await read();
      }
      if (result.error || !result.data) {
        span.error('Contacts read failed');
        throw result.error ?? new Error('Contacts read returned no data');
      }
      const metadata = normalizedCacheResultMetadata(result);
      if (metadata?.source === 'live-network') await metadata.persistence;
      data = result.data;
    }
    if (getGraphqlSoupClient() !== client)
      throw new Error('Contacts read superseded');
    span.setAttr('contacts.count', data.user.contacts.length);
    return selectContacts(data);
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
