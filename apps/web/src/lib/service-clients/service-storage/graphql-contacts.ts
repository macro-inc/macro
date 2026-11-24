import type { CacheHost } from '@graphql-cache/host/types';
import { captureContactWriteScope } from '@graphql-cache/people/sync';
import { CONTACT_SYNC_UNSUPPORTED } from '@graphql-cache/people/sync-protocol';
import type { HydrationScope } from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import { print } from 'graphql';
import {
  ContactDirectoryBackfillDocument,
  type ContactDirectoryBackfillQuery,
  type ContactDirectoryBackfillQueryVariables,
  type ContactDirectoryBackfillResult,
  ContactDirectoryBackfillWithListsDocument,
  ContactDirectoryByUserIdsDocument,
  type ContactDirectoryByUserIdsQuery,
  ContactDirectoryByUserIdsWithListsDocument,
  ContactDirectoryPageDocument,
  type ContactDirectoryPageQuery,
  type ContactDirectoryPageQueryVariables,
  ContactNamedPeopleDocument,
  type ContactNamedPeopleQuery,
  type ContactNamedPeopleQueryVariables,
  ContactReferencePageDocument,
  type ContactReferencePageQuery,
  type ContactReferencePageQueryVariables,
} from './graphql/generated/graphql';
import {
  getGraphqlSoupNetworkClient,
  graphqlSoupTransportDocument,
} from './graphql-soup';

const PAGE_SIZE = 500;

/** The cache-writing reads, with and without each contact's `lists`. A server
 * without the field refuses any read that selects it, so callers pick. */
export type ContactListSelection = { lists?: boolean };

function backfillDocument(lists: boolean) {
  const query = print(
    lists
      ? ContactDirectoryBackfillWithListsDocument
      : ContactDirectoryBackfillDocument
  );
  return {
    query,
    transport: graphqlSoupTransportDocument(query),
    operationName: lists
      ? 'ContactDirectoryBackfillWithLists'
      : 'ContactDirectoryBackfill',
  };
}

const BACKFILL = {
  plain: backfillDocument(false),
  lists: backfillDocument(true),
};

/** Membership-scoped exact lookup; empty input is never a directory listing. */
export async function fetchContactDirectoryByIds(
  userIds: string[],
  signal: AbortSignal,
  selection: ContactListSelection = {}
): Promise<ContactDirectoryByUserIdsQuery> {
  signal.throwIfAborted();
  if (userIds.length > PAGE_SIZE)
    throw new Error('Contact lookup exceeds its batch bound');
  const result = await getGraphqlSoupNetworkClient()
    .query(
      selection.lists
        ? ContactDirectoryByUserIdsWithListsDocument
        : ContactDirectoryByUserIdsDocument,
      { userIds },
      {
        requestPolicy: 'network-only',
        fetchOptions: { signal },
      }
    )
    .toPromise();
  signal.throwIfAborted();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Contact lookup returned no data');
  return result.data;
}

/** Foreground fallback is one bounded server page, never the legacy full list.
 * It is fetch-only: obsolete UI requests cannot change cache identity. */
export async function fetchContactDirectoryPage(
  variables: ContactDirectoryPageQueryVariables,
  signal: AbortSignal
): Promise<ContactDirectoryPageQuery> {
  signal.throwIfAborted();
  const result = await getGraphqlSoupNetworkClient()
    .query(ContactDirectoryPageDocument, variables, {
      requestPolicy: 'network-only',
      fetchOptions: { signal },
    })
    .toPromise();
  signal.throwIfAborted();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Contact directory returned no data');
  return result.data;
}

/** The people typed text names across the viewer's whole directory, ranked by
 * the server, at most 50 and without a continuation. Fetch-only. */
export async function fetchContactNamedPeople(
  variables: ContactNamedPeopleQueryVariables,
  signal: AbortSignal
): Promise<ContactNamedPeopleQuery> {
  signal.throwIfAborted();
  const result = await getGraphqlSoupNetworkClient()
    .query(ContactNamedPeopleDocument, variables, {
      requestPolicy: 'network-only',
      fetchOptions: { signal },
    })
    .toPromise();
  signal.throwIfAborted();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Named contacts returned no data');
  return result.data;
}

/** Exact reference predicates run on the server before its result limit. This
 * fetch-only page still obeys the search work budget and may be empty with a cursor. */
export async function fetchContactReferencePage(
  variables: ContactReferencePageQueryVariables,
  signal: AbortSignal
): Promise<ContactReferencePageQuery> {
  signal.throwIfAborted();
  const result = await getGraphqlSoupNetworkClient()
    .query(ContactReferencePageDocument, variables, {
      requestPolicy: 'network-only',
      fetchOptions: { signal },
    })
    .toPromise();
  signal.throwIfAborted();
  if (result.error) throw result.error;
  if (!result.data)
    throw new Error('Contact reference lookup returned no data');
  return result.data;
}

/** One bounded page, explicitly admitted after cancellation checks. The engine
 * checks account/generation again under its lock; returning a cursor proves the
 * page was persisted, never merely downloaded. No urql history retains nodes. */
export async function hydrateGraphqlContacts(
  host: Pick<CacheHost, 'hydrateQuery' | 'disabled' | 'people'>,
  scope: HydrationScope,
  after: string | null,
  signal: AbortSignal,
  selection: ContactListSelection = {}
): Promise<ContactDirectoryBackfillResult> {
  return Telemetry.span('contacts.hydrate_page', async (span) => {
    signal.throwIfAborted();
    const document = selection.lists ? BACKFILL.lists : BACKFILL.plain;
    span.setAttr('contacts.lists', selection.lists === true);
    if (host.disabled)
      throw new Error('Contact hydration requires an active cache');
    const guarded = await captureContactWriteScope(host, scope, signal);
    if (!guarded) throw new Error(CONTACT_SYNC_UNSUPPORTED);
    const variables: ContactDirectoryBackfillQueryVariables = {
      limit: PAGE_SIZE,
      after,
    };
    const result = await getGraphqlSoupNetworkClient()
      .query<
        ContactDirectoryBackfillQuery,
        ContactDirectoryBackfillQueryVariables
      >(document.transport, variables, {
        requestPolicy: 'network-only',
        fetchOptions: { signal },
      })
      .toPromise();
    signal.throwIfAborted();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Contact hydration returned no data');
    const data = result.data;
    if (data.user.contacts.nodes.length > PAGE_SIZE)
      throw new Error('Contact hydration exceeds its batch bound');
    span.setAttr('contacts.page_count', data.user.contacts.nodes.length);
    const hydrated = await span.span('contacts.persist_page', () =>
      host.hydrateQuery({
        generation: result.operation.context.cacheSessionGeneration,
        query: document.query,
        operationName: document.operationName,
        variables,
        data,
        identity: data.user.id,
        hydrationScope: guarded,
      })
    );
    signal.throwIfAborted();
    if (hydrated.kind !== 'data')
      throw new Error('Contact hydration was not persisted');
    return {
      user: {
        id: data.user.id,
        contacts: { nextCursor: data.user.contacts.nextCursor },
      },
    };
  });
}
