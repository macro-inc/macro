import '@app/index.css';
import { createStaticListDataSource } from '@app/components/list';
import { ListFilterDropdown } from '@app/components/view-shell/ListDropdowns';
import {
  createMemoryHistory,
  createMemoryPaneStore,
  createSplitRouter,
  type Entry,
  SplitRouter,
  type SplitRoutes,
} from '@app/lib/split-router';
import { SplitRouterProvider } from '@app/lib/split-router/solid/context';
import { paneRoute } from '@app/routes/app-route';
import { appRoute, homeSplitRoute, tasksSplitRoute } from '@app/routes/routes';
import { SplitLayoutContext } from '@components/app/split-layout/context';
import {
  createSplitLayout,
  type SplitManager,
} from '@components/app/split-layout/layoutManager';
import { createAppPanePolicy } from '@components/app/split-layout/split-router/app-pane-policy';
import { createOwnedSlots } from '@components/app/split-layout/utils/createOwnedSlots';
import { useViewRestoration } from '@components/app/split-layout/view-restoration';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { BlockOrchestrator } from '@core/orchestrator';
import type { TaskEntityWithProperties } from '@entity/types/entity';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { PropertyDefinition } from '@service-storage/generated/schemas/propertyDefinition';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { TasksFilterDrawer } from '../../components/TasksFilterDrawer';
import { TasksMobileTabs } from '../../components/TasksMobileTabs';
import { BUILT_IN_TASK_TABS } from '../../constants';
import { taskMatchesView } from '../../filters/task-predicates';
import { captureTaskSavedView } from '../../filters/task-saved-view';
import { useTaskFilters } from '../../filters/use-task-filters';
import type {
  TasksDataSource,
  UseTasksDataSourceOptions,
} from '../../queries/use-tasks-query';
import { TasksViewProvider, useTasksView } from '../../tasks-view-context';
import type { TasksViewState } from '../../types';
import { PanelContext, setViewer, VIEWER } from './adapters';
import { resolveContentLocation, splitContentFromLocation } from './routes';

const STATUS: PropertyDefinition = {
  id: SYSTEM_PROPERTY_IDS.STATUS,
  display_name: 'Status',
  data_type: 'SELECT_STRING',
  is_metadata: false,
  is_multi_select: false,
  is_system: true,
  owner: { scope: 'system' },
  specific_entity_type: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};
const TASKS: TaskEntityWithProperties[] = [
  {
    type: 'document',
    fileType: 'md',
    id: 'task-progress',
    name: 'Progress task',
    ownerId: VIEWER,
    subType: { type: 'task', is_completed: false },
    properties: [
      {
        id: 'progress-status',
        definition: STATUS,
        value: {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.IN_PROGRESS],
        },
      },
      {
        id: 'progress-assignee',
        definition: {
          ...STATUS,
          id: SYSTEM_PROPERTY_IDS.ASSIGNEES,
          data_type: 'ENTITY',
        },
        value: {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: VIEWER }],
        },
      },
    ],
  },
  {
    type: 'document',
    fileType: 'md',
    id: 'task-completed',
    name: 'Completed task',
    ownerId: VIEWER,
    subType: { type: 'task', is_completed: true },
    properties: [
      {
        id: 'completed-status',
        definition: STATUS,
        value: {
          type: 'SelectOption',
          value: [PROPERTY_OPTION_IDS.STATUS.COMPLETED],
        },
      },
      {
        id: 'completed-assignee',
        definition: {
          ...STATUS,
          id: SYSTEM_PROPERTY_IDS.ASSIGNEES,
          data_type: 'ENTITY',
        },
        value: {
          type: 'EntityReference',
          value: [{ entity_type: 'USER', entity_id: VIEWER }],
        },
      },
    ],
  },
];
const SAVED_ID = '10000000-0000-4000-8000-000000000001';
const savedConfig = captureTaskSavedView({
  tab: 'team-tasks',
  facets: { status: ['in-review'] },
  context: { tagPropertyDefinitionByOptionId: new Map() },
});
if (savedConfig.isErr()) throw new Error(savedConfig.error);
const SAVED = {
  id: SAVED_ID,
  ownerId: VIEWER,
  name: 'Review tasks',
  revision: 1,
  sharedTeamId: null,
  config: savedConfig.value,
};
function source(
  state: TasksViewState,
  options: UseTasksDataSourceOptions
): TasksDataSource {
  return {
    ...createStaticListDataSource(() =>
      TASKS.filter((task) =>
        taskMatchesView(task, {
          tab: state.tab,
          userId: options.userId(),
          facets: state.facets,
        })
      ).map((entity) => ({ kind: 'entity' as const, id: entity.id, entity }))
    ),
    loadMoreGroup: async () => {},
  };
}
const ORCHESTRATOR: BlockOrchestrator = {
  isBlockMounted: () => false,
  getBlockHandle: async () => undefined,
  setBlockScope: () => {},
  createBlockInstance: () => {
    throw new Error('No block renderer in this fixture');
  },
  rekeyBlockInstance: () => {},
  registerBlockHandle: () => undefined,
};
const ROUTES: SplitRoutes = {
  definitions: [
    {
      ...appRoute,
      component: () => <SplitRouter.Outlet />,
      children: [
        { ...homeSplitRoute, component: () => <p>Home</p> },
        {
          ...tasksSplitRoute,
          component: () => (
            <TasksViewProvider
              sourceFactory={source}
              savedViewSource={(selected) => ({
                data: () => (selected() === SAVED_ID ? SAVED : undefined),
                viewerId: () => VIEWER,
                loading: () => false,
                error: () => undefined,
                refresh: async () => {},
              })}
            >
              <Controls />
            </TasksViewProvider>
          ),
        },
      ],
    },
  ],
  defaultRoute: () => paneRoute({ id: 'view-tasks', params: {} }),
};

function Controls() {
  useViewRestoration('tasks');
  const view = useTasksView();
  const filters = useTaskFilters();
  return (
    <main class="mx-auto max-w-3xl p-4 text-ink">
      <h1 class="mb-4 text-xl">Tasks</h1>
      <Show
        when={isTouchDevice()}
        fallback={
          <div class="mb-4 flex gap-2">
            <For each={BUILT_IN_TASK_TABS}>
              {(tab) => (
                <Button
                  variant="ghost"
                  aria-pressed={
                    view.state.tab === tab.id && !view.state.savedViewActive
                  }
                  onClick={() => view.setTab(tab.id)}
                >
                  {tab.label}
                </Button>
              )}
            </For>
            <ListFilterDropdown
              label="Filter tasks"
              groups={filters.groups()}
              isSelected={filters.isSelected}
              selectedIds={filters.selectedIds}
              onSelectionChange={filters.setSelected}
              onClear={filters.clear}
            />
          </div>
        }
      >
        <div class="mb-6 h-12">
          <TasksMobileTabs leading={<TasksFilterDrawer />} />
        </div>
      </Show>
      <div class="my-4 flex flex-wrap gap-2">
        <Button onClick={() => view.selectSavedView(SAVED_ID)}>
          Open saved view
        </Button>
        <Button onClick={() => view.startSavedView()}>New saved view</Button>
      </div>
      <output hidden data-testid="tab">
        {view.state.tab}
      </output>
      <output hidden data-testid="facets">
        {JSON.stringify(view.state.facets)}
      </output>
      <output hidden data-testid="saved-state">
        {view.savedViews?.view().kind}
      </output>
      <ul class="mt-4 divide-y divide-edge-muted" aria-label="Task results">
        <For each={view.source.items()}>
          {(row) => (
            <li class="py-3">{row.kind === 'entity' ? row.entity.name : ''}</li>
          )}
        </For>
      </ul>
    </main>
  );
}
function App() {
  let manager: SplitManager | undefined;
  const router = createSplitRouter({
    routes: ROUTES,
    history: createMemoryHistory('/tasks'),
    paneStore: createMemoryPaneStore<Entry>(),
    policy: createAppPanePolicy({
      manager: () => manager,
      toContent: splitContentFromLocation,
      defaultLocation: () => ({ route: ROUTES.defaultRoute() }),
      stacked: () => false,
    }),
  });
  manager = createSplitLayout(ORCHESTRATOR, {
    router,
    toLocation: (content) => resolveContentLocation(router.routes, content),
    toContent: splitContentFromLocation,
    stacked: () => false,
  });
  const layout = manager;
  const split = layout.splits()[0];
  const handle = layout.getSplit(split.id);
  if (!handle) throw new Error('Missing fixture split');
  const pane = router.panes()[0];
  const slots = createOwnedSlots();
  return (
    <SplitRouterProvider router={router}>
      <SplitLayoutContext.Provider value={{ manager: layout }}>
        <PanelContext.Provider
          value={{ handle, replaceOwnedSlot: slots.replace }}
        >
          <div class="flex flex-wrap gap-2 p-4">
            <Button
              onClick={() =>
                layout.openWithSplit(
                  { type: 'component', id: 'home' },
                  { handle }
                )
              }
            >
              Leave Tasks
            </Button>
            <Button
              onClick={() =>
                layout.openWithSplit(
                  { type: 'component', id: 'tasks' },
                  { handle, resume: true }
                )
              }
            >
              Resume Tasks
            </Button>
            <Button onClick={() => setViewer('another-test-viewer')}>
              Switch account
            </Button>
          </div>
          <SplitRouter.Outlet pane={pane} />
        </PanelContext.Provider>
      </SplitLayoutContext.Provider>
    </SplitRouterProvider>
  );
}
render(() => <App />, document.getElementById('root')!);
