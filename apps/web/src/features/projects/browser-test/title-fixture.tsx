import '@app/index.css';
import {
  createBrowserHistory,
  createMemoryPaneStore,
  createSplitRouter,
  defineRoute,
  SplitRouter,
  useCanGo,
  useNavigate,
  useRouteParams,
} from '@app/lib/split-router';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import {
  SidePanelContext,
  type SidePanelContextType,
} from '@components/app/side-panel/context';
import { runSplitBack } from '@components/app/split-layout/back-interceptor';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import { Button, Tabs } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { z } from 'zod';
import { ProjectTitleMenu } from '../components/project-title-menu';
import {
  type ProjectSource,
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import type { ProjectDetail, ProjectSection } from '../core/project';
import { MobileProjectDetailHeader } from '../views/mobile/project-detail-header';
import { priority, status } from './collection-data';

const projectDetailRoute = defineRoute({
  id: 'tasks-project',
  path: 'projects/:projectId/:section',
  params: z.object({
    projectId: z.string().uuid(),
    section: z.enum(['overview', 'tasks']),
  }),
  remountKey: ({ projectId }) => projectId,
});
const projectId = '00000000-0000-4000-8000-000000000001';
const params = new URLSearchParams(location.search);
// Keep the fixture entry inside the browser history owned by the split router.
history.replaceState(
  history.state,
  '',
  `/title.html/projects/${projectId}/overview`
);

const unavailable = (): never => {
  throw new Error(
    'External project capability is unavailable in title fixture'
  );
};

function Fixture() {
  const navigate = useNavigate();
  const canGoBack = useCanGo(-1);
  const route = useRouteParams(projectDetailRoute);
  const section = () => route.section;
  const changeSection = (next: ProjectSection) =>
    navigate({
      route: projectDetailRoute,
      params: { projectId, section: next },
    });
  const [access, setAccess] = createSignal<ProjectDetail['access']>(
    params.get('access') === 'view' ? 'view' : 'owner'
  );
  const [definitionsLoaded, setDefinitionsLoaded] = createSignal(
    !params.has('lateDefinitions')
  );
  const [name, setName] = createSignal(
    params.has('longName')
      ? 'An exceptionally long project title that must not hide the Tasks shortcut or Share control'
      : 'Launch'
  );
  const [shared, setShared] = createSignal(0);
  const [deleted, setDeleted] = createSignal(0);
  const [titleFileMenuRef, setTitleFileMenuRef] =
    createSignal<HTMLDivElement>();
  const [titleFileMenuTrigger, setTitleFileMenuTrigger] =
    createSignal<() => void>();
  const [titleFileMenuActions, setTitleFileMenuActions] =
    createSignal<
      SplitPanelContextType['titleFileMenuActions'] extends () => infer T
        ? T
        : never
    >();
  const project = (): ProjectDetail => ({
    id: projectId,
    taskCount: 8,
    completedTaskCount: 3,
    name: name(),
    ownerId: 'owner',
    memberIds: [],
    taskIds: [],
    access: access(),
    createdAt: '',
    updatedAt: '',
  });
  const source: ProjectSource = {
    project,
    properties: () => [],
    loading: () => false,
    error: () => undefined,
    refresh: async () => {},
  };
  const commands: ReturnType<ProjectsContext['createCommands']> = {
    createTask: unavailable,
    pending: () => false,
    create: unavailable,
    rename: async (_id, next) => {
      setName(next);
    },
    setMembers: unavailable,
    delete: async () => {
      setDeleted((count) => count + 1);
    },
    deleteMany: unavailable,
    assignTasks: unavailable,
    saveProperty: unavailable,
    saveProperties: unavailable,
  };
  const context: ProjectsContext = {
    userId: () => 'owner',
    createCollectionSource: unavailable,
    createProjectSource: () => source,
    createPropertyDefinitionsSource: () => ({
      properties: () => (definitionsLoaded() ? [status, priority] : []),
      loading: () => false,
      error: () => undefined,
    }),
    createCommands: () => commands,
  };
  // The panel owns the real menu's mount and trigger, as SplitPanel does in the app.
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const [headerLeft, setHeaderLeft] = createSignal<HTMLDivElement>();
  const [headerRight, setHeaderRight] = createSignal<HTMLDivElement>();
  const panel: SplitPanelContextType = {
    get handle() {
      return unavailable();
    },
    splitHotkeyScope: 'project-title-fixture',
    mobileHeaderOwner: createSignal<symbol>(),
    isPanelActive: () => true,
    panelRef: () => null,
    panelSize: { width: null, height: null },
    contentOffsetTop,
    setContentOffsetTop,
    bottomPanel: () => undefined,
    registerBottomPanel: unavailable,
    layoutRefs: {
      get headerLeft() {
        return headerLeft();
      },
      get headerRight() {
        return headerRight();
      },
    },
    titleFileMenuRef,
    setTitleFileMenuRef,
    titleFileMenuTrigger,
    setTitleFileMenuTrigger,
    titleFileMenuActions,
    setTitleFileMenuActions,
    replaceOwnedSlot: unavailable,
    get headerCollapser() {
      return unavailable();
    },
    get toolbarCollapser() {
      return unavailable();
    },
  };
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [detailsMount, setDetailsMount] = createSignal<HTMLDivElement>();
  const [overlayMode, setOverlayMode] = createSignal(true);
  const details: SidePanelContextType = {
    headerActionsMount: detailsMount,
    setHeaderActionsMount: setDetailsMount,
    register: () => {},
    unregister: () => {},
    sections: () => [],
    hasSections: () => true,
    isOpen: detailsOpen,
    setIsOpen: setDetailsOpen,
    toggle: () => setDetailsOpen((open) => !open),
    unseenCount: () => 0,
    reportUnseenCount: () => {},
    setOpenSectionIds: () => {},
    openSectionIds: () => [],
    isOverlayMode: overlayMode,
    setIsOverlayMode: setOverlayMode,
    isFloating: () => true,
    persistentFloating: () => false,
  };
  return (
    <ProjectsProvider context={context}>
      <SidePanelContext.Provider value={details}>
        <SplitPanelContext.Provider value={panel}>
          <main class="min-h-screen bg-app p-6 text-ink touch:px-3">
            <div
              class="@container/split-header flex min-w-0 items-center justify-between gap-2"
              data-testid="header-row"
            >
              <Show when={isTouchDevice()}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Go back"
                  disabled={!canGoBack()}
                  onClick={() =>
                    runSplitBack({
                      canGoBack,
                      goBack: () => {
                        fireAndForget(navigate(-1), 'project-title-fixture');
                      },
                    })
                  }
                >
                  <CaretLeft class="size-6" />
                </Button>
              </Show>
              <div
                class="flex min-w-0 flex-1 items-center gap-2"
                ref={setHeaderLeft}
              />
              <div
                class="flex shrink-0 items-center gap-2"
                ref={setHeaderRight}
              />
            </div>
            <Show
              when={isTouchDevice()}
              fallback={
                <>
                  <ProjectTitleMenu
                    project={project()}
                    source={source}
                    commands={commands}
                    section={section()}
                    onShare={() => setShared((count) => count + 1)}
                    onDelete={() => {}}
                  />
                  <Tabs<ProjectSection>
                    aria-label="Project sections"
                    value={section()}
                    onChange={changeSection}
                    options={[
                      { value: 'overview', label: 'Overview' },
                      { value: 'tasks', label: 'Tasks' },
                    ]}
                  />
                </>
              }
            >
              <MobileProjectDetailHeader
                source={source}
                commands={commands}
                section={section()}
                onSectionChange={changeSection}
                onShare={() => setShared((count) => count + 1)}
                onDelete={() => {}}
                hotkeyScope=""
              />
            </Show>
            <output data-testid="section">{section()}</output>
            <output data-testid="name">{name()}</output>
            <output data-testid="shares">{shared()}</output>
            <output data-testid="deletes">{deleted()}</output>
            <button onClick={() => setDefinitionsLoaded(true)}>
              Load definitions
            </button>
            <button
              data-testid="revoke-project-access"
              onClick={() => setAccess('view')}
            >
              Revoke edit access
            </button>
            <FloatRegionHost />
          </main>
        </SplitPanelContext.Provider>
      </SidePanelContext.Provider>
    </ProjectsProvider>
  );
}

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => {
  const router = createSplitRouter({
    routes: {
      definitions: [{ ...projectDetailRoute, component: Fixture }],
      defaultRoute: () => ({
        matches: [
          {
            id: projectDetailRoute.id,
            params: { projectId, section: 'overview' },
          },
        ],
      }),
    },
    history: createBrowserHistory({ base: '/title.html' }),
    paneStore: createMemoryPaneStore(),
    policy: {
      placeNewPane: ({ source, panes }) => ({ pane: source ?? panes[0]! }),
      closeAction: () => ({ type: 'keep' }),
      activate: () => {},
    },
  });
  return (
    <SplitRouter.Root router={router}>
      <SplitRouter.Outlet />
    </SplitRouter.Root>
  );
}, root);
