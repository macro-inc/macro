import type { CacheHost } from '@graphql-cache/host/types';
import type { HydrationScope } from '@graphql-cache/protocol';
import { Telemetry } from '@macro-inc/observability';
import { print } from 'graphql';
import {
  ContactDirectoryBackfillDocument,
  type ContactDirectoryBackfillQuery,
  type ContactDirectoryBackfillQueryVariables,
  type ContactDirectoryBackfillResult,
  ContactDirectoryByUserIdsDocument,
  type ContactDirectoryByUserIdsQuery,
  ContactDirectoryPageDocument,
  type ContactDirectoryPageQuery,
  type ContactDirectoryPageQueryVariables,
  ContactReferencePageDocument,
  type ContactReferencePageQuery,
  type ContactReferencePageQueryVariables,
} from './graphql/generated/graphql';
import {
  getGraphqlSoupNetworkClient,
  graphqlSoupTransportDocument,
} from './graphql-soup';

const DOCUMENT = print(ContactDirectoryBackfillDocument);
const TRANSPORT_DOCUMENT = graphqlSoupTransportDocument(DOCUMENT);
const PAGE_SIZE = 500;

/** Membership-scoped exact lookup; empty input is never a directory listing. */
export async function fetchContactDirectoryByIds(
  userIds: string[],
  signal: AbortSignal
): Promise<ContactDirectoryByUserIdsQuery> {
  signal.throwIfAborted();
  if (userIds.length > PAGE_SIZE)
    throw new Error('Contact lookup exceeds its batch bound');
  const result = await getGraphqlSoupNetworkClient()
    .query(
      ContactDirectoryByUserIdsDocument,
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
  host: Pick<CacheHost, 'hydrateQuery' | 'disabled'>,
  scope: HydrationScope,
  after: string | null,
  signal: AbortSignal
): Promise<ContactDirectoryBackfillResult> {
  return Telemetry.span('contacts.hydrate_page', async (span) => {
    signal.throwIfAborted();
    if (host.disabled)
      throw new Error('Contact hydration requires an active cache');
    const variables: ContactDirectoryBackfillQueryVariables = {
      limit: PAGE_SIZE,
      after,
    };
    const result = await getGraphqlSoupNetworkClient()
      .query<
        ContactDirectoryBackfillQuery,
        ContactDirectoryBackfillQueryVariables
      >(TRANSPORT_DOCUMENT, variables, {
        requestPolicy: 'network-only',
        fetchOptions: { signal },
      })
      .toPromise();
    signal.throwIfAborted();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Contact hydration returned no data');
    const data = result.data;
    span.setAttr('contacts.page_count', data.user.contacts.nodes.length);
    const hydrated = await span.span('contacts.persist_page', () =>
      host.hydrateQuery({
        query: DOCUMENT,
        operationName: 'ContactDirectoryBackfill',
        variables,
        data,
        identity: data.user.id,
        hydrationScope: scope,
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
