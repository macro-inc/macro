import '@app/index.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Tabs } from '@ui';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { ProjectTitleMenu } from '../components/project-title-menu';
import {
  type ProjectSource,
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import type { ProjectDetail, ProjectSection } from '../core/project';
import { MobileProjectDetailHeader } from '../views/mobile/project-detail-header';
import { priority, status } from './collection-data';

const unavailable = (): never => {
  throw new Error(
    'External project capability is unavailable in title fixture'
  );
};

function Fixture() {
  const params = new URLSearchParams(location.search);
  const [access, setAccess] = createSignal<ProjectDetail['access']>(
    params.get('access') === 'view' ? 'view' : 'owner'
  );
  const [definitionsLoaded, setDefinitionsLoaded] = createSignal(
    !params.has('lateDefinitions')
  );
  const [section, setSection] = createSignal<ProjectSection>('overview');
  const [name, setName] = createSignal('Launch');
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
    id: 'project',
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
  return (
    <ProjectsProvider context={context}>
      <SplitPanelContext.Provider value={panel}>
        <main class="min-h-screen bg-app p-6 text-ink">
          <div class="flex items-center justify-between">
            <div ref={setHeaderLeft} />
            <div ref={setHeaderRight} />
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
                  onChange={setSection}
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
              onSectionChange={setSection}
              onShare={() => setShared((count) => count + 1)}
              onDelete={() => {}}
              hotkeyScope="project-title-fixture"
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
    </ProjectsProvider>
  );
}

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
