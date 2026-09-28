// Real task-list property cells, production queries/exchange and worker/WASM
// cache. Only HTTP is replaced; no hosted workspace data is read or changed.
import '@app/index.css';
import { createUrqlQuery } from '@app/lib/urql-solid/create-urql-query';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { soupPropertyToProperty } from '@entity/extractors-property/property-helpers';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { SYSTEM_PROPERTY_IDS, PROPERTY_OPTION_IDS } from '@property/constants';
import type { Property, PropertyApiValues } from '@property/types';
import { queryClient } from '@queries/client';
import { useBulkSaveEntityPropertiesMutation } from '@queries/properties/entity';
import { propertiesKeys } from '@queries/properties/keys';
import { EntityPropertiesDocument, type SoupPropertyFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupClient, mapGraphqlProperties } from '@service-storage/graphql-soup';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ListPropertyValue } from '../components/task-list/ListPropertyValue';

enableGraphqlSoup.override = true;
const taskIds = ['00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000102'];
const definitionId = SYSTEM_PROPERTY_IDS.PRIORITY;
const urgent = PROPERTY_OPTION_IDS.PRIORITY.URGENT;
const placeholder = soupPropertyToProperty({
  id: `pending:${definitionId}`,
  definition: { id: definitionId, display_name: 'Priority', data_type: 'SELECT_STRING',
    is_multi_select: false, is_metadata: false, is_system: true, owner: { scope: 'system' },
    created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString() },
});
queryClient.setQueryData(propertiesKeys.options({ propertyDefinitionId: definitionId }).queryKey, placeholder.options);
const saved = new Map<string, SoupPropertyFieldsFragment>();
const pending: Array<(success: boolean) => void> = [];
const [requestCount, setRequestCount] = createSignal(0);
const [settledCount, setSettledCount] = createSignal(0);
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (!String(input).includes('/items/soup/graphql')) return nativeFetch(input, init);
  const body = JSON.parse(String(init?.body)) as { query: string; variables: { input: { entityId?: string; value?: { selectOption?: string } } } };
  if (body.query.includes('mutation SetEntityProperty')) {
    setRequestCount((value) => value + 1);
    return await new Promise<Response>((resolve) => {
      pending.push((success) => {
        const id = body.variables.input.entityId!;
        const property: SoupPropertyFieldsFragment = {
          id: id.replace(/1(\d\d)$/, '2$1'), propertyDefinitionId: definitionId,
          displayName: 'Priority', dataType: 'SELECT_STRING', isMultiSelect: false,
          isMetadata: false, isSystem: true, specificEntityType: null,
          value: { __typename: 'GraphqlSelectOptionPropertyValue', optionIds: [body.variables.input.value?.selectOption ?? urgent] },
        };
        if (success) saved.set(id, property);
        setSettledCount((value) => value + 1);
        resolve(Response.json(success ? { data: { setEntityProperty: property } } : { errors: [{ message: 'Rejected by fixture' }] }));
      });
    });
  }
  return Response.json({ data: { user: { id: 'macro|task-optimism@example.test',
    soup: { items: taskIds.map((id) => ({ __typename: 'GraphqlSoupDocument', id, properties: saved.has(id) ? [saved.get(id)] : [] })) },
  } } });
};

function Fixture() {
  const query = createUrqlQuery(() => ({
    client: getGraphqlSoupClient(), query: EntityPropertiesDocument,
    variables: { input: { initial: { limit: 2 } } }, requestPolicy: 'cache-and-network',
  }));
  const save = useBulkSaveEntityPropertiesMutation();
  const property = (entityId: string): Property => {
    const raw = query.data?.user.soup.items.find((item) => item.id === entityId)?.properties ?? [];
    return mapGraphqlProperties(raw).map(soupPropertyToProperty).find((p) => p.propertyDefinitionId === definitionId) ?? placeholder;
  };
  const saveOne = async (entityId: string, value: Property, apiValues: PropertyApiValues) => {
    await save.mutateAsync({ properties: [{ entityId, entityType: 'TASK', property: value, apiValues }] });
  };
  return <main class="p-8 text-ink bg-page min-h-screen">
    <h1>Task priority optimistic cache regression</h1>
    <p>HTTP requests: {requestCount()} · Settled: {settledCount()}</p>
    <Show when={query.data} fallback={<p>Loading</p>}>
      <For each={taskIds}>{(entityId, index) =>
        <section aria-label={`Task ${index() + 1}`} class="flex items-center gap-4 py-3">
          <span>Task {index() + 1}</span>
          <PropertiesProvider entityId={entityId} entityType="TASK" canEdit properties={() => [property(entityId)]}
            onRefresh={() => {}} onPropertyAdded={() => {}} onPropertyDeleted={() => {}}
            saveHandler={{ saveProperty: (p, v) => saveOne(entityId, p, v), saveDate: (p, value) => saveOne(entityId, p, { valueType: 'DATE', value }) }}>
            <ListPropertyValue property={property(entityId)} />
          </PropertiesProvider>
          <output data-assignment={entityId}>{property(entityId).propertyId}</output>
        </section>
      }</For>
      <button onClick={() => save.mutate({ properties: taskIds.map((entityId) => ({ entityId, entityType: 'TASK', property: property(entityId), apiValues: { valueType: 'SELECT_STRING', values: [urgent] } })) })}>Set both Urgent</button>
      <button onClick={() => pending.shift()?.(true)}>Commit next request</button>
      <button onClick={() => pending.shift()?.(false)}>Fail next request</button>
    </Show>
  </main>;
}
render(() => <QueryClientProvider client={queryClient}><Fixture /></QueryClientProvider>, document.querySelector('#root')!);
