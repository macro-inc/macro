import { ViewShell, ViewSidebar } from '@app/components/view-shell';
import { PROJECT_TABS } from '@app/features/tasks-view/constants';
import { projectScopeForTab } from '@app/features/tasks-view/core/task-navigation';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { withApiValues } from '@property/utils/transforms';
import { ImperativeDialogHost } from '@ui';
import deepEqual from 'fast-deep-equal';
import { batch, createMemo, createSignal, For } from 'solid-js';
import { createStore } from 'solid-js/store';
import { createSavedViewCreation } from '../../saved-views/primitives/create-saved-view-creation';
import { createSavedViewDraft } from '../../saved-views/primitives/create-saved-view-draft';
import { ProjectSavedViewsContext } from '../context/project-saved-views-context';
import {
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import {
  DEFAULT_PROJECT_SETTINGS,
  type ProjectFilters,
  type ProjectScope,
} from '../core/project';
import type { ProjectSavedViewConfig } from '../core/project-saved-view';
import {
  captureProjectSavedView,
  decodeProjectSavedView,
  projectSavedViewsEqual,
  readProjectSavedView,
} from '../core/project-saved-view';
import { createProjectCollection } from '../primitives/project-collection';
import { ProjectSavedViewsList } from '../views/project-saved-views';
import { ProjectsCollection } from '../views/projects-collection';
import {
  filterProjectFixtureRows,
  priority,
  rows,
  status,
} from './collection-data';
import { savedRecords, seedUnsupported } from './saved-view-transport';

const unavailable = (): never => {
  throw new Error('External capability unavailable in collection fixture');
};
const assignees: Property = {
  propertyId: 'assignees-value',
  propertyDefinitionId: SYSTEM_PROPERTY_IDS.ASSIGNEES,
  displayName: 'Assignees',
  isMultiSelect: true,
  owner: { scope: 'system' },
  createdAt: '',
  updatedAt: '',
  valueType: 'ENTITY',
  specificEntityType: 'USER',
  value: [
    { entity_type: 'USER', entity_id: 'viewer' },
    { entity_type: 'USER', entity_id: 'colleague' },
  ],
};

export function CollectionFixture() {
  const [attachHotkeys, scopeId] = useHotkeyDOMScope('projects-browser');
  const [selectedId, setSelectedId] = createSignal<string>();
  const [scope, setScope] = createSignal<ProjectScope>('all');
  const [creating, setCreating] = createSignal(false);
  const [opened, setOpened] = createSignal('');
  const [createdProjects, setCreatedProjects] = createSignal(0);
  const params = new URLSearchParams(location.search);
  const [projectRows, setProjectRows] = createSignal(
    (params.has('emptyProjects') ? [] : rows).map((row) => ({
      ...row,
      project: {
        ...row.project,
        access: params.has('readOnly') ? ('view' as const) : ('owner' as const),
      },
      properties: [
        ...(params.has('noPriority')
          ? row.properties.filter(
              (property) =>
                property.propertyDefinitionId !== SYSTEM_PROPERTY_IDS.PRIORITY
            )
          : row.properties),
        ...(row.project.id === 'alpha' ? [assignees] : []),
      ],
    }))
  );
  const [savedProperty, setSavedProperty] = createSignal('');
  const [state, setState] = createStore({
    settings: { ...DEFAULT_PROJECT_SETTINGS },
    scope: 'all' as ProjectScope,
  });
  const viewerId = () => 'viewer';
  const source = {
    data: () =>
      selectedId()
        ? (savedRecords().find((record) => record.id === selectedId()) ?? null)
        : undefined,
    viewerId,
    error: () => undefined,
    loading: () => false,
    refresh: async () => {},
  };
  const draft = createSavedViewDraft({
    source,
    selectedId,
    viewerId,
    creating,
    capture: () => captureProjectSavedView(state.settings, state.scope),
    defaults: () => captureProjectSavedView(DEFAULT_PROJECT_SETTINGS, scope()),
    read: readProjectSavedView,
    decode: decodeProjectSavedView,
    equal: projectSavedViewsEqual,
    apply: (config) =>
      setState({ settings: { ...config.settings }, scope: config.scope }),
    resetNew: () => setState('settings', { ...DEFAULT_PROJECT_SETTINGS }),
  });
  const creation = createSavedViewCreation({
    kind: 'projects',
    viewerId,
    list: savedRecords,
    capture: () => draft.capture().unwrapOr(undefined),
    equal: deepEqual,
    confirmed: () => setCreating(false),
  });
  const discardNew = () => {
    creation.discard();
    setCreating(false);
  };
  const select = (id?: string) =>
    batch(() => {
      setCreating(false);
      setSelectedId(id);
    });
  const views = {
    creation,
    discardNew,
    selectCreated: (id: string) => select(id),
    viewerId,
    source,
    draft,
    selectedId,
    scope: () => (selectedId() || creating() ? state.scope : scope()),
    list: {
      items: () => savedRecords(),
      loading: () => false,
      error: () => undefined,
      hasMore: () => false,
      loadingMore: () => false,
      loadMore: async () => {},
      refresh: async () => {},
    },
    selectScope: (next: ProjectScope) =>
      batch(() => {
        if (selectedId() || next !== scope()) {
          setState('settings', { ...DEFAULT_PROJECT_SETTINGS });
        }
        select();
        setScope(next);
      }),
    request: () => ({ revision: draft.revision(), isCurrent: () => true }),
    select,
    start: (
      config?: ProjectSavedViewConfig,
      name = 'New view',
      afterStart?: () => void,
      changed = false
    ) => {
      batch(() => {
        setSelectedId(undefined);
        setCreating(true);
        setState({
          settings: { ...(config?.settings ?? DEFAULT_PROJECT_SETTINGS) },
          scope: config?.scope ?? 'all',
        });
        creation.begin(draft.capture().unwrapOr(undefined), name, changed);
      });
      afterStart?.();
    },
    creating,
    active: () => true,
    ready: () => {
      const view = draft.view();
      return (
        view.kind !== 'loading' &&
        view.kind !== 'unavailable' &&
        (view.kind !== 'saved' || view.issues.length === 0)
      );
    },
    settings: () => state.settings,
    persistentSettings: () => state.settings,
    updateSettings: (patch: Partial<typeof DEFAULT_PROJECT_SETTINGS>) =>
      setState('settings', patch),
    team: () => undefined,
  };
  const context: ProjectsContext = {
    userId: viewerId,
    createCollectionSource: (filters, enabled) => ({
      rows: createMemo(() => {
        if (enabled && !enabled()) return undefined;
        const selected: ProjectFilters = filters?.() ?? {};
        return filterProjectFixtureRows(projectRows(), selected).filter(
          (row) =>
            (!selected.status ||
              row.properties.some(
                (property) =>
                  property.propertyDefinitionId ===
                    SYSTEM_PROPERTY_IDS.STATUS &&
                  property.valueType === 'SELECT_STRING' &&
                  property.value?.includes(selected.status!)
              )) &&
            (!selected.query ||
              row.project.name
                .toLowerCase()
                .includes(selected.query.toLowerCase())) &&
            (!selected.assignee || row.project.id === 'alpha') &&
            (!selected.owner || row.project.id === 'beta')
        );
      }),
      loading: () => false,
      error: () => undefined,
      hasMore: () => false,
      loadingMore: () => false,
      loadMore: async () => {},
      refresh: async () => {},
    }),
    createProjectIdentitySource: unavailable,
    createProjectSource: unavailable,
    createPropertyDefinitionsSource: () => ({
      properties: () => [status, priority],
      loading: () => false,
      error: () => undefined,
    }),
    createCommands: () => ({
      createTask: unavailable,
      pending: () => false,
      create: unavailable,
      rename: unavailable,
      setMembers: unavailable,
      assignTasks: unavailable,
      delete: unavailable,
      deleteMany: unavailable,
      saveProperty: async (id, property, value) => {
        setSavedProperty(
          `${id}:${property.propertyDefinitionId}:${JSON.stringify(value)}`
        );
        setProjectRows((rows) =>
          rows.map((row) => {
            if (row.project.id !== id) return row;
            const properties = row.properties.filter(
              (current) =>
                current.propertyDefinitionId !== property.propertyDefinitionId
            );
            return {
              ...row,
              properties: [...properties, withApiValues(property, value)],
            };
          })
        );
      },
      saveProperties: unavailable,
    }),
  };
  const collection = createProjectCollection({
    createSource: context.createCollectionSource,
    userId: context.userId,
    settings: { value: views.settings, update: views.updateSettings },
    scope: views.scope,
    enabled: views.ready,
    onOpen: setOpened,
  });
  return (
    <ProjectsProvider context={context}>
      <ProjectSavedViewsContext.Provider value={views}>
        <main
          ref={attachHotkeys}
          class="relative flex h-screen min-h-0 flex-col bg-app text-ink"
        >
          <ViewShell.Root class="flex min-h-0 flex-1">
            <ViewShell.Aside>
              <ViewSidebar.Root data-testid="saved-view-sidebar">
                <ViewSidebar.Header>Projects</ViewSidebar.Header>
                <ViewSidebar.Content>
                  <ViewSidebar.Nav aria-label="Project views">
                    <For each={PROJECT_TABS}>
                      {(tab) => (
                        <ViewSidebar.Item
                          onClick={() =>
                            views.selectScope(projectScopeForTab(tab.id))
                          }
                        >
                          {tab.label}
                        </ViewSidebar.Item>
                      )}
                    </For>
                  </ViewSidebar.Nav>
                  <ProjectSavedViewsList />
                </ViewSidebar.Content>
              </ViewSidebar.Root>
            </ViewShell.Aside>
            <ViewShell.Main class="flex min-h-0 flex-1 flex-col">
              <ProjectsCollection
                collection={collection}
                mobileNavigation={
                  <ViewSidebar.Toggle action="expand" presentation="pill" />
                }
                onOpen={setOpened}
                onCreate={() => setCreatedProjects((count) => count + 1)}
                createAssigneeName={(id) => id}
                scopeId={scopeId}
                isActive={() => true}
                ganttEnabled={false}
                canOpenInNewSplit={() => false}
                onCopyLink={async () => {}}
                onCopyId={async () => {}}
              />
            </ViewShell.Main>
          </ViewShell.Root>
          <output data-testid="opened">{opened()}</output>
          <output data-testid="created-projects">{createdProjects()}</output>
          <output data-testid="settings">
            {JSON.stringify(state.settings)}
          </output>
          <output data-testid="selected">{selectedId() ?? ''}</output>
          <output hidden data-testid="saved-property">
            {savedProperty()}
          </output>
          <output hidden data-testid="project-records">
            {JSON.stringify(projectRows())}
          </output>
          <button type="button" onClick={seedUnsupported}>
            Seed unsupported view
          </button>
          <FloatRegionHost />
          <ImperativeDialogHost />
        </main>
      </ProjectSavedViewsContext.Provider>
    </ProjectsProvider>
  );
}
