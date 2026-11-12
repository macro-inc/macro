import '@app/index.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import {
  SplitPanelContext,
  type SplitPanelContextType,
} from '@components/app/split-layout/context';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Tabs } from '@ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { ProjectTitleMenu } from '../components/project-title-menu';
import {
  type ProjectSource,
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import type { ProjectDetail, ProjectSection } from '../core/project';

const unavailable = (): never => {
  throw new Error(
    'External project capability is unavailable in title fixture'
  );
};

function Fixture() {
  const params = new URLSearchParams(location.search);
  const access = params.get('access') === 'view' ? 'view' : 'owner';
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
    access,
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
      properties: () => [],
      loading: () => false,
      error: () => undefined,
    }),
    createCommands: () => commands,
  };
  // The panel owns the real menu's mount and trigger, as SplitPanel does in the app.
  const [contentOffsetTop, setContentOffsetTop] = createSignal(0);
  const panel: SplitPanelContextType = {
    get handle() {
      return unavailable();
    },
    splitHotkeyScope: 'project-title-fixture',
    isPanelActive: () => true,
    panelRef: () => null,
    panelSize: { width: null, height: null },
    contentOffsetTop,
    setContentOffsetTop,
    bottomPanel: () => undefined,
    registerBottomPanel: unavailable,
    layoutRefs: {},
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
          <output data-testid="section">{section()}</output>
          <output data-testid="name">{name()}</output>
          <output data-testid="shares">{shared()}</output>
          <output data-testid="deletes">{deleted()}</output>
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
