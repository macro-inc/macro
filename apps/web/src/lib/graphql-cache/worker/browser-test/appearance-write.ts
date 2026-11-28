import { shouldRetryGraphqlMutation } from '@service-storage/graphql-mutation-retry';
import {
  createClient,
  fetchExchange,
  gql,
  stringifyDocument,
} from '@urql/core';
import { soupOptimisticResolvers } from '../../../queries/optimistic-resolvers';
import { normalizedCacheExchange } from '../../exchange/normalized-cache-exchange';
import { optimisticMutationDispositionOf } from '../../exchange/optimistic';
import { optimisticResolversExchange } from '../../exchange/optimistic-resolvers';
import { createWorkerCacheHost } from '../../host/worker-host';
import { cacheSessionGeneration } from '../../session-generation';

const args = new URLSearchParams(location.search);
const scope = args.get('scope') ?? crypto.randomUUID();
const offline = args.has('offline');
const hold = args.has('hold');
const listCount = Number(args.get('lists') ?? '8');
const documentId = '10000000-0000-4000-8000-000000000001';
const host = createWorkerCacheHost({ scope: `appearance-${scope}` });
const lifetime = new AbortController();
const status = document.querySelector<HTMLOutputElement>('#status')!;
const counts = document.querySelector<HTMLOutputElement>('#requests')!;
const lists = document.querySelector<HTMLOListElement>('#lists')!;
const save = document.querySelector<HTMLButtonElement>('#save')!;
const answer = Promise.withResolvers<void>();
document
  .querySelector('#answer')
  ?.addEventListener('click', () => answer.resolve());

const list = gql`
  query AppearanceSoup($input: SoupInput!) {
    user {
      id
      soup(input: $input) {
        items {
          __typename
          id
          displayName
          ... on GraphqlSoupDocument { appearance }
        }
      }
    }
  }
`;

const mutation = gql`
  mutation SetEntityAppearance($input: SetEntityAppearanceInput!) {
    setEntityAppearance(input: $input) {
      results {
        __typename
        ... on GraphqlMutationSuccess {
          effects {
            __typename
            ... on SoupUpdated {
              item {
                __typename
                id
                displayName
                ... on GraphqlSoupDocument { appearance }
              }
            }
          }
        }
        ... on GraphqlMutationError { errorCode message }
      }
    }
  }
`;

const row = {
  __typename: 'GraphqlSoupDocument',
  id: documentId,
  displayName: 'Shared note',
  appearance: null,
};
const rows = [
  row,
  ...Array.from({ length: 49 }, (_, i) => ({
    ...row,
    id: `20000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    displayName: `Note ${i + 2}`,
  })),
];
const listData = {
  user: {
    id: 'fixture-viewer',
    soup: { items: rows },
  },
};
const pages = Array.from({ length: listCount }, (_, i) => ({
  input: {
    initial: {
      limit: 50,
      filters: {
        documentFilter: {
          literal: {
            projectId: `30000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          },
        },
      },
    },
  },
}));
const generation = (await host.authority?.current())?.generation;
if (!generation) throw new Error('Expected a cache generation');
cacheSessionGeneration.initialize(generation);
if (!args.has('replay')) {
  for (const variables of pages) {
    await host.writeQuery({
      generation,
      query: stringifyDocument(list),
      operationName: 'AppearanceSoup',
      variables,
      data: listData,
    });
  }
}
let listReads = 0;
let writes = 0;
function showRequests() {
  counts.textContent = `Soup reads ${listReads} · GraphQL writes ${writes}`;
}
showRequests();
status.textContent = offline ? 'Offline' : 'Online';
const unsubscribeSettlement = host.onMutationSettled((settlement) => {
  status.textContent = settlement.status;
});

const client = createClient({
  url: 'http://appearance.fixture/graphql',
  preferGetMethod: false,
  exchanges: [
    optimisticResolversExchange(soupOptimisticResolvers),
    normalizedCacheExchange(host, {
      signal: lifetime.signal,
      shouldRetryMutation: shouldRetryGraphqlMutation,
      mutationQueueLocks: navigator.locks,
    }),
    fetchExchange,
  ],
  fetch: async (_input, init) => {
    const { operationName } = JSON.parse(String(init?.body));
    if (operationName === 'AppearanceSoup') {
      listReads += 1;
      showRequests();
      return Response.json({ data: listData });
    }
    if (operationName !== 'SetEntityAppearance')
      throw new Error(`Unexpected operation ${operationName}`);
    if (offline) throw new TypeError('Offline');
    writes += 1;
    showRequests();
    if (hold) await answer.promise;
    return Response.json({
      data: {
        setEntityAppearance: {
          results: [
            {
              __typename: 'GraphqlMutationSuccess',
              effects: [
                {
                  __typename: 'SoupUpdated',
                  item: {
                    ...row,
                    appearance: {
                      icon: { kind: 'emoji', value: '🌿' },
                      color: 'teal',
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    });
  },
});

const subscriptions = pages.map((variables, i) => {
  const node = document.createElement('li');
  lists.append(node);
  return client.query(list, variables).subscribe((result) => {
    if (result.error) {
      status.textContent = result.error.message;
      return;
    }
    const items = result.data?.user.soup.items;
    if (items?.length !== 50) return;
    node.textContent = `List ${i + 1} · ${items[0].displayName} · ${items[0].appearance?.color ?? 'default'}`;
    if (
      [...lists.children].filter((item) => item.textContent).length ===
      listCount
    )
      save.disabled = false;
  });
});
save.addEventListener('click', async () => {
  const result = await client
    .mutation(mutation, {
      input: {
        entity: { type: 'DOCUMENT', id: documentId },
        icon: { emoji: '🌿' },
        color: 'GREEN',
      },
    })
    .toPromise();
  if (result.error) status.textContent = result.error.message;
  else
    status.textContent =
      optimisticMutationDispositionOf(result)?.kind ?? 'direct';
});
window.addEventListener(
  'pagehide',
  () => {
    lifetime.abort();
    unsubscribeSettlement();
    subscriptions.forEach(({ unsubscribe }) => unsubscribe());
    host.dispose();
  },
  { once: true }
);
