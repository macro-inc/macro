// Real task-list property cells, production queries/exchange and worker/WASM
// cache. Only HTTP is replaced; no hosted workspace data is read or changed.
import '@app/index.css';
import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { soupPropertyToProperty } from '@entity/extractors-property/property-helpers';
import { ListPropertyValue } from '@property/component/ListPropertyValue';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import type { Property, PropertyApiValues } from '@property/types';
import { queryClient } from '@queries/client';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { propertiesKeys } from '@queries/properties/keys';
import { registerGraphqlSoupRevalidations } from '@queries/soup/graphql/active-queries';
import { NOT_SET_GROUP_KEY } from '@queries/soup/grouped/types';
import {
  EntityPropertiesDocument,
  GroupSoupDocument,
  GroupSoupMembershipDocument,
  type GroupSoupMembershipQuery,
  type SoupPropertyFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  mapGraphqlProperties,
} from '@service-storage/graphql-soup';
import { QueryClientProvider } from '@tanstack/solid-query';
import { stringifyDocument } from '@urql/core';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';

enableGraphqlSoup.override = true;
const taskIds = [
  '00000000-0000-0000-0000-000000000101',
  '00000000-0000-0000-0000-000000000102',
];
const definitionId = SYSTEM_PROPERTY_IDS.PRIORITY;
const urgent = PROPERTY_OPTION_IDS.PRIORITY.URGENT;
const groupedMode = new URLSearchParams(location.search).has('grouped');
const groupedInput = {
  initial: {
    groupBy: { field: 'PROPERTY' as const, propertyDefinitionId: definitionId },
    limit: 2,
  },
};
const [historyReady, setHistoryReady] = createSignal(false);
const [membershipReads, setMembershipReads] = createSignal(0);
const [inspections, setInspections] = createSignal(0);
const [groupFetches, setGroupFetches] = createSignal(0);
const [historicalGroupFetches, setHistoricalGroupFetches] = createSignal(0);
function groupedData(): GroupSoupMembershipQuery {
  const idsFor = (key: string) =>
    taskIds.filter((id) => {
      const value = saved.get(id)?.value;
      return (
        (value?.__typename === 'GraphqlSelectOptionPropertyValue'
          ? value.optionIds[0]
          : NOT_SET_GROUP_KEY) === key
      );
    });
  return {
    user: {
      id: 'macro|task-optimism@example.test',
      groupSoup: {
        bins: [NOT_SET_GROUP_KEY, urgent].map((key) => {
          const ids = idsFor(key);
          return {
            key,
            totalCount: ids.length,
            nextCursor: null,
            items: ids.map((id) => ({
              __typename: 'GraphqlSoupDocument' as const,
              id,
            })),
          };
        }),
      },
    },
  };
}
const placeholder = soupPropertyToProperty({
  id: `pending:${definitionId}`,
  definition: {
    id: definitionId,
    display_name: 'Priority',
    data_type: 'SELECT_STRING',
    is_multi_select: false,
    is_metadata: false,
    specific_entity_type: null,
    is_system: true,
    owner: { scope: 'system' },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  },
});
queryClient.setQueryData(
  propertiesKeys.options({ propertyDefinitionId: definitionId }).queryKey,
  placeholder.options
);
const saved = new Map<string, SoupPropertyFieldsFragment>();
const pending: Array<(success: boolean) => void> = [];
const [requestCount, setRequestCount] = createSignal(0);
const [settledCount, setSettledCount] = createSignal(0);
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (!String(input).includes('/items/soup/graphql'))
    return nativeFetch(input, init);
  const body = JSON.parse(String(init?.body)) as {
    query: string;
    variables: {
      input: {
        entityId?: string;
        value?: { selectOption?: string };
        initial?: { limit?: number };
      };
    };
  };
  if (body.query.includes('mutation SetEntityProperty')) {
    setRequestCount((value) => value + 1);
    return await new Promise<Response>((resolve) => {
      pending.push((success) => {
        const id = body.variables.input.entityId!;
        const property: SoupPropertyFieldsFragment = {
          id: id.replace(/1(\d\d)$/, '2$1'),
          propertyDefinitionId: definitionId,
          displayName: 'Priority',
          dataType: 'SELECT_STRING',
          isMultiSelect: false,
          isMetadata: false,
          isSystem: true,
          specificEntityType: null,
          value: {
            __typename: 'GraphqlSelectOptionPropertyValue',
            optionIds: [body.variables.input.value?.selectOption ?? urgent],
          },
        };
        if (success) saved.set(id, property);
        setSettledCount((value) => value + 1);
        resolve(
          Response.json(
            success
              ? { data: { setEntityProperty: property } }
              : { errors: [{ message: 'Rejected by fixture' }] }
          )
        );
      });
    });
  }
  if (body.query.includes('query GroupSoupMembership')) {
    setGroupFetches((value) => value + 1);
    if (body.variables.input.initial?.limit !== groupedInput.initial.limit) {
      setHistoricalGroupFetches((value) => value + 1);
    }
    return Response.json({ data: groupedData() });
  }
  return Response.json({
    data: {
      user: {
        id: 'macro|task-optimism@example.test',
        soup: {
          items: taskIds.map((id) => ({
            __typename: 'GraphqlSoupDocument',
            id,
            properties: saved.has(id) ? [saved.get(id)] : [],
          })),
        },
      },
    },
  });
};

function Fixture() {
  const query = createUrqlQuery(() => ({
    client: getGraphqlSoupClient(),
    query: EntityPropertiesDocument,
    variables: { input: { initial: { limit: 2 } } },
    requestPolicy: 'cache-and-network',
  }));
  const grouped = createUrqlQuery(() => ({
    client: getGraphqlSoupClient(),
    query: GroupSoupMembershipDocument,
    variables: { input: groupedInput },
    enabled: groupedMode,
    requestPolicy: 'cache-and-network',
  }));
  onCleanup(
    registerGraphqlSoupRevalidations(() =>
      groupedMode
        ? [{ document: GroupSoupDocument, variables: { input: groupedInput } }]
        : []
    )
  );
  onMount(async () => {
    if (!groupedMode) return;
    const host = getGraphqlCacheHost()!;
    // Real historical query variants, none registered as an active view.
    for (let limit = 3; limit < 133; limit++) {
      await host.writeQuery({
        query: stringifyDocument(GroupSoupMembershipDocument),
        operationName: 'GroupSoupMembership',
        variables: { input: { initial: { ...groupedInput.initial, limit } } },
        data: groupedData(),
      });
    }
    const read = host.readQuery.bind(host);
    host.readQuery = (args) => {
      if (
        args.operationName === 'GroupSoupMembership' &&
        args.opKey === undefined
      )
        setMembershipReads((value) => value + 1);
      return read(args);
    };
    const inspect = host.inspectQueryVariants.bind(host);
    host.inspectQueryVariants = (args) => {
      setInspections((value) => value + 1);
      return inspect(args);
    };
    setHistoryReady(true);
  });
  const groupItems = (key: string) =>
    grouped.data?.user.groupSoup.bins
      .find((bin) => bin.key === key)
      ?.items.map((item) => taskIds.indexOf(item.id) + 1)
      .sort()
      .join(',') ?? '';
  const [successes, setSuccesses] = createSignal(0);
  const [failures, setFailures] = createSignal(0);
  const save = useBulkSaveEntityPropertiesMutation({
    onSuccess: () => {
      setSuccesses((value) => value + 1);
    },
    onError: () => {
      setFailures((value) => value + 1);
    },
  });
  const property = (entityId: string): Property => {
    const raw =
      query.data?.user.soup?.items.find((item) => item.id === entityId)
        ?.properties ?? [];
    return (
      mapGraphqlProperties(raw)
        .map(soupPropertyToProperty)
        .find((p) => p.propertyDefinitionId === definitionId) ?? placeholder
    );
  };
  const saveOne = async (
    entityId: string,
    value: Property,
    apiValues: PropertyApiValues
  ) => {
    await save.mutateAsync({
      properties: [
        { entityId, entityType: 'TASK', property: value, apiValues },
      ],
    });
  };
  return (
    <main class="p-8 text-ink bg-page min-h-screen">
      <h1>Task priority optimistic cache regression</h1>
      <p>
        HTTP requests: {requestCount()} · Settled: {settledCount()}
      </p>
      <p aria-label="Save status">
        Pending: {save.isPending ? 'yes' : 'no'} · Succeeded: {successes()} ·
        Failed: {failures()}
      </p>
      <Show when={groupedMode}>
        <output aria-label="Historical grouped pages">
          {historyReady() ? '130 ready' : 'Loading'}
        </output>
        <output aria-label="Membership reads">{membershipReads()}</output>
        <output aria-label="Cache inspections">{inspections()}</output>
        <output aria-label="Group fetches">{groupFetches()}</output>
        <output aria-label="Historical group fetches">
          {historicalGroupFetches()}
        </output>
        <output aria-label="Unset group">
          {groupItems(NOT_SET_GROUP_KEY)}
        </output>
        <output aria-label="Urgent group">{groupItems(urgent)}</output>
      </Show>
      <Show when={query.data} fallback={<p>Loading</p>}>
        <For each={taskIds}>
          {(entityId, index) => (
            <section
              aria-label={`Task ${index() + 1}`}
              class="flex items-center gap-4 py-3"
            >
              <span>Task {index() + 1}</span>
              <PropertiesProvider
                entityId={entityId}
                entityType="TASK"
                canEdit
                properties={() => [property(entityId)]}
                onRefresh={() => {}}
                onPropertyAdded={() => {}}
                onPropertyDeleted={() => {}}
                saveHandler={{
                  saveProperty: (p, v) => saveOne(entityId, p, v),
                  saveDate: (p, value) =>
                    saveOne(entityId, p, { valueType: 'DATE', value }),
                }}
              >
                <ListPropertyValue
                  property={property(entityId)}
                  entityId={entityId}
                />
              </PropertiesProvider>
              <output data-assignment={entityId}>
                {property(entityId).propertyId}
              </output>
            </section>
          )}
        </For>
        <button
          onClick={() =>
            save.mutate({
              properties: taskIds.map((entityId) => ({
                entityId,
                entityType: 'TASK',
                property: property(entityId),
                apiValues: { valueType: 'SELECT_STRING', values: [urgent] },
              })),
            })
          }
        >
          Set both Urgent
        </button>
        <button onClick={() => pending.shift()?.(true)}>
          Commit next request
        </button>
        <button onClick={() => pending.shift()?.(false)}>
          Fail next request
        </button>
      </Show>
    </main>
  );
}
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <Fixture />
    </QueryClientProvider>
  ),
  document.querySelector('#root')!
);
