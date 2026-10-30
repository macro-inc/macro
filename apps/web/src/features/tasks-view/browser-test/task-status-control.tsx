// Production task layouts and property editors over synthetic rows; only HTTP is replaced.
import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
import { Entity, type TaskEntityWithProperties } from '@entity';
import { NarrowLayout } from '@entity/composed/list-entity/narrow-layout';
import { soupPropertyToProperty } from '@entity/extractors-property/property-helpers';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { propertiesKeys } from '@queries/properties/keys';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { TaskGridLayout } from '../components/task-list/TaskGridLayout';

enableGraphqlSoup.override = false;
const statusDefinition = {
  id: SYSTEM_PROPERTY_IDS.STATUS,
  display_name: 'Status',
  data_type: 'SELECT_STRING' as const,
  is_metadata: false,
  is_multi_select: false,
  is_system: true,
  owner: { scope: 'system' as const },
  specific_entity_type: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
};
const statusProperty = {
  id: '00000000-0000-0000-0000-000000000201',
  definition: statusDefinition,
  value: {
    type: 'SelectOption' as const,
    value: [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED],
  },
};
const priorityProperty = {
  id: '00000000-0000-0000-0000-000000000202',
  definition: {
    ...statusDefinition,
    id: SYSTEM_PROPERTY_IDS.PRIORITY,
    display_name: 'Priority',
  },
};
const tasks: TaskEntityWithProperties[] = [
  {
    id: '00000000-0000-0000-0000-000000000101',
    name: 'Task with status',
    ownerId: 'macro|status-fixture@example.test',
    type: 'document',
    fileType: 'md',
    subType: { type: 'task', is_completed: false },
    properties: [statusProperty],
  },
  {
    id: '00000000-0000-0000-0000-000000000102',
    name: 'Task without status',
    ownerId: 'macro|status-fixture@example.test',
    type: 'document',
    fileType: 'md',
    subType: { type: 'task', is_completed: true },
    properties: [],
  },
];
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'macro|status-fixture@example.test',
  email: 'status-fixture@example.test',
  authenticated: true,
});
queryClient.setQueryData(
  propertiesKeys.options({ propertyDefinitionId: SYSTEM_PROPERTY_IDS.STATUS })
    .queryKey,
  soupPropertyToProperty(statusProperty).options
);
queryClient.setQueryData(
  propertiesKeys.options({ propertyDefinitionId: SYSTEM_PROPERTY_IDS.PRIORITY })
    .queryKey,
  soupPropertyToProperty(priorityProperty).options
);

const pending: Array<(succeeds: boolean) => void> = [];
const [requests, setRequests] = createSignal(0);
const [settled, setSettled] = createSignal(0);
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes('/properties/entities/') && init?.method === 'PUT') {
    setRequests((count) => count + 1);
    return await new Promise<Response>((resolve) => {
      pending.push((succeeds) => {
        setSettled((count) => count + 1);
        resolve(
          Response.json(succeeds ? {} : { message: 'Fixture rejection' }, {
            status: succeeds ? 200 : 500,
          })
        );
      });
    });
  }
  if (url.includes('/properties/entities/'))
    return Response.json({ properties: [] });
  if (url.includes('/properties/definitions/'))
    return Response.json(
      soupPropertyToProperty(
        url.includes(SYSTEM_PROPERTY_IDS.PRIORITY)
          ? priorityProperty
          : statusProperty
      ).options
    );
  if (url.startsWith(location.origin)) return originalFetch(input, init);
  return Response.json({}, { status: 404 });
};

function Fixture() {
  const [opened, setOpened] = createSignal(0);
  const narrow = new URLSearchParams(location.search).has('narrow');
  return (
    <main class="min-h-screen bg-page p-5 text-ink">
      <div aria-label="Navigation count">{opened()}</div>
      <div aria-label="Save requests">
        {requests()} pending, {settled()} settled
      </div>
      <button type="button" onClick={() => pending.shift()?.(true)}>
        Complete save
      </button>
      <button type="button" onClick={() => pending.shift()?.(false)}>
        Fail save
      </button>
      <div class="@container/u-list mt-6">
        <For each={tasks}>
          {(entity) => (
            <Entity.Root
              entity={entity}
              onClick={() => setOpened((count) => count + 1)}
              aria-label={entity.name}
            >
              {narrow ? (
                <NarrowLayout
                  entity={entity}
                  hideCheckbox
                  unread={false}
                  isShared={false}
                  hasNotifications={false}
                  showHitSnippet={false}
                  setSnippetContainerRef={() => {}}
                  chars={200}
                />
              ) : (
                <TaskGridLayout
                  entity={entity}
                  hideCheckbox
                  unread={false}
                  isShared={false}
                  hasNotifications={false}
                  showHitSnippet={false}
                  setSnippetContainerRef={() => {}}
                  chars={200}
                />
              )}
            </Entity.Root>
          )}
        </For>
      </div>
    </main>
  );
}
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <Fixture />
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);
