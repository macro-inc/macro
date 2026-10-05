import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import { disableBrowserTursoCache } from '@core/constant/featureFlags';
import { UserContextProvider } from '@core/context/user';
import { normalizedCacheResultMetadata } from '@graphql-cache/exchange/normalized-cache-exchange';
import { TagSetsProvider } from '@property/tags/tag-sets-context';
import { useDocTags, useSoupDocTags } from '@property/tags/useDocTags';
import { queryClient } from '@queries/client';
import { useInFlightEntityPropertyOptions } from '@queries/properties/in-flight-options';
import { propertiesKeys } from '@queries/properties/keys';
import { buildGraphqlEntitySoupInput } from '@queries/soup/graphql/entity-input';
import { createGraphqlGroupedSoupAstItemsQuery } from '@queries/soup/graphql/grouped-items';
import { createGraphqlSoupAstItemsQuery } from '@queries/soup/graphql/items';
import {
  EntityPropertiesDocument,
  RenameEntitiesDocument,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { QueryClientProvider } from '@tanstack/solid-query';
import type { OperationResult } from '@urql/core';
import { createComputed, createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import {
  ASSIGNMENT_ID,
  BLUE_TAG,
  DOCS_TAG,
  DOCUMENT_ID,
  OTHER_DOCUMENT_ID,
  TAG_DEFINITION_ID,
  tagSets,
} from './data';

const mode = new URLSearchParams(location.search).get('cache') ?? 'cached';
disableBrowserTursoCache.override = mode === 'disabled';
queryClient.setQueryData(propertiesKeys.tags.queryKey, tagSets);

type Snapshot = {
  detail: string[];
  list: string[];
  grouped: string[];
  raw: string[];
  assignments: string[];
  pending: boolean;
  overlay: boolean;
  completed: number;
  failures: number;
  unrelatedReads: number;
  name: string | undefined;
};

const trace: Snapshot[] = [];
let read: () => Snapshot;
type ReadResult = Pick<OperationResult, 'extensions'>;
let refetch: () => Promise<ReadResult>;
let pendingRead: Promise<ReadResult> | undefined;

function Readers() {
  const tags = useDocTags(DOCUMENT_ID, 'DOCUMENT');
  const list = createGraphqlSoupAstItemsQuery(
    () => ({ params: { sort_method: 'updated_at' }, body: {} }),
    () => ({ enabled: true })
  );
  const listTags = useSoupDocTags(DOCUMENT_ID, 'DOCUMENT', () => {
    const entity = list.data()?.entities.find(({ id }) => id === DOCUMENT_ID);
    return entity && 'properties' in entity ? entity.properties : undefined;
  });
  const grouped = createGraphqlGroupedSoupAstItemsQuery(
    () => ({
      params: { sort_method: 'updated_at' },
      body: {},
      groupBy: { type: 'project' },
    }),
    () => ({ enabled: true })
  );
  const groupedTags = useSoupDocTags(DOCUMENT_ID, 'DOCUMENT', () => {
    const entity = grouped
      .data()
      ?.entities.find(({ id }) => id === DOCUMENT_ID);
    return entity && 'properties' in entity ? entity.properties : undefined;
  });
  const raw = createUrqlQuery(() => ({
    client: getGraphqlSoupClient(),
    query: EntityPropertiesDocument,
    variables: { input: buildGraphqlEntitySoupInput('DOCUMENT', DOCUMENT_ID)! },
    requestPolicy: 'cache-and-network',
  }));
  const overlay = useInFlightEntityPropertyOptions(DOCUMENT_ID);
  const [pending, setPending] = createSignal(0);
  const [completed, setCompleted] = createSignal(0);
  const [failures, setFailures] = createSignal(0);
  const [showMirror, setShowMirror] = createSignal(true);
  let unrelatedReads = 0;
  createComputed(() => {
    const name = list
      .data()
      ?.entities.find(({ id }) => id === OTHER_DOCUMENT_ID)?.name;
    if (name) unrelatedReads++;
  });
  const assignments = () => raw.data?.user.soup.items[0]?.properties ?? [];
  read = () => ({
    detail: tags
      .appliedTags()
      .map(({ label }) => label)
      .sort(),
    list: listTags
      .appliedTags()
      .map(({ label }) => label)
      .sort(),
    grouped: groupedTags
      .appliedTags()
      .map(({ label }) => label)
      .sort(),
    raw: assignments()
      .flatMap(({ value }) =>
        value?.__typename === 'GraphqlSelectOptionPropertyValue'
          ? value.optionIds
          : []
      )
      .sort(),
    assignments: assignments().map(({ id }) => id),
    pending: pending() > 0,
    overlay: overlay(TAG_DEFINITION_ID) !== undefined,
    completed: completed(),
    failures: failures(),
    unrelatedReads,
    name: list.data()?.entities.find(({ id }) => id === DOCUMENT_ID)?.name,
  });
  refetch = () => raw.refetch({ requestPolicy: 'network-only' });
  createComputed(() => {
    const value = read();
    if (JSON.stringify(trace.at(-1)) !== JSON.stringify(value))
      trace.push(value);
  });
  async function edit(action: () => Promise<void>) {
    setPending((value) => value + 1);
    try {
      await action();
      setCompleted((value) => value + 1);
    } catch {
      setFailures((value) => value + 1);
    } finally {
      setPending((value) => value - 1);
    }
  }
  function Mirror() {
    const mirrored = useDocTags(DOCUMENT_ID, 'DOCUMENT');
    return (
      <output data-testid="mirror">
        {mirrored
          .appliedTags()
          .map(({ label }) => label)
          .sort()
          .join(',')}
      </output>
    );
  }
  async function rename() {
    const result = await getGraphqlSoupClient()
      .mutation(RenameEntitiesDocument, {
        inputs: [
          {
            entity: { type: 'DOCUMENT', id: DOCUMENT_ID },
            displayName: 'Renamed task',
          },
        ],
      })
      .toPromise();
    if (result.error) throw result.error;
  }
  return (
    <>
      <button onClick={() => void edit(rename)}>Rename task</button>
      <button onClick={() => void edit(() => tags.applyTag('user', DOCS_TAG))}>
        Add docs
      </button>
      <button onClick={() => void edit(() => tags.applyTag('user', BLUE_TAG))}>
        Add blue
      </button>
      <button onClick={() => void edit(() => tags.removeTag('user', DOCS_TAG))}>
        Remove docs
      </button>
      <button onClick={() => setShowMirror((value) => !value)}>
        Toggle subscriber
      </button>
      <output data-testid="detail">
        {tags
          .appliedTags()
          .map(({ label }) => label)
          .sort()
          .join(',')}
      </output>
      <output data-testid="list">
        {listTags
          .appliedTags()
          .map(({ label }) => label)
          .sort()
          .join(',')}
      </output>
      <output data-testid="name">
        {list.data()?.entities.find(({ id }) => id === DOCUMENT_ID)?.name}
      </output>
      <output data-testid="grouped">
        {groupedTags
          .appliedTags()
          .map(({ label }) => label)
          .sort()
          .join(',')}
      </output>
      <output data-testid="ready">
        {list.data()?.entities.length === 2 &&
        grouped.data()?.entities.length === 2 &&
        raw.data
          ? 'ready'
          : 'loading'}
      </output>
      <Show when={showMirror()}>
        <Mirror />
      </Show>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('missing functional test root');
const dispose = render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={queryClient}>
          <UserContextProvider>
            <TagSetsProvider tagSets={() => tagSets}>
              <Readers />
            </TagSetsProvider>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  root
);

const api = {
  read: () => read(),
  trace: () => trace,
  clearTrace: () => {
    trace.length = 0;
  },
  delayCacheReads(ms: number) {
    const host = getGraphqlCacheHost();
    if (!host) throw new Error('expected an active cache');
    const readQuery = host.readQuery.bind(host);
    host.readQuery = async (...args) => {
      const result = await readQuery(...args);
      await new Promise((resolve) => setTimeout(resolve, ms));
      return result;
    };
    const watchQuery = host.watchQuery?.bind(host);
    if (watchQuery) {
      host.watchQuery = async (...args) => {
        const result = await watchQuery(...args);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return result;
      };
    }
  },
  async addIncompletePropertyLink() {
    await getGraphqlCacheHost()?.writeQuery({
      query: `query PartialProperties($input: SoupInput!) {
        user { id soup(input: $input) { items {
          __typename id ... on GraphqlSoupDocument { properties { id } }
        } } }
      }`,
      variables: {
        input: buildGraphqlEntitySoupInput('DOCUMENT', DOCUMENT_ID)!,
      },
      data: {
        user: {
          id: 'functional-viewer',
          soup: {
            items: [
              {
                __typename: 'GraphqlSoupDocument',
                id: DOCUMENT_ID,
                properties: [
                  { id: ASSIGNMENT_ID },
                  { id: '00000000-0000-4000-8000-000000000008' },
                ],
              },
            ],
          },
        },
      },
    });
  },
  refetch: () => {
    pendingRead = refetch();
  },
  async waitForRead() {
    const result = await pendingRead;
    // A network result is visible before its normalized write completes.
    if (result) {
      const metadata = normalizedCacheResultMetadata(result);
      if (metadata?.source === 'live-network') await metadata.persistence;
    }
    await getGraphqlCacheHost()?.currentRevision();
  },
  retireCache: () => getGraphqlCacheHost()?.dispose(),
  hasCache: () => !!getGraphqlCacheHost(),
  dispose,
};
declare global {
  interface Window {
    optimisticMutations: typeof api;
  }
}
window.optimisticMutations = api;
