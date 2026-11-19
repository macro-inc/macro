import '@app/index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { mountGlobalFocusListener } from '@app/signal/focus';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { MobileCreateButton } from '@components/app/mobile/MobileCreateButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { AddProjectTasks } from '../../add-project-tasks';
import {
  type ProjectsContext,
  ProjectsProvider,
} from '../../context/projects-context';
import type { ProjectDetail } from '../../core/project';
import { NewProjectTaskPill } from '../../new-project-task';
import { ProjectTasksList } from '../../views/project-tasks-list';

const project: ProjectDetail = {
  id: 'project',
  name: 'Launch',
  taskIds: ['linked'],
  ownerId: 'owner',
  memberIds: [],
  access: 'owner',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const unavailable = (): never => {
  throw new Error('Capability unavailable in the tasks header fixture');
};

const readOnly = new URLSearchParams(location.search).has('readOnly');

function Fixture() {
  mountGlobalFocusListener();
  const [creates, setCreates] = createSignal(0);
  const [outsideCreates, setOutsideCreates] = createSignal(0);
  const [assignments, setAssignments] = createSignal(0);
  const context: ProjectsContext = {
    userId: () => 'owner',
    createCollectionSource: unavailable,
    createProjectSource: unavailable,
    createProjectIdentitySource: unavailable,
    createPropertyDefinitionsSource: unavailable,
    createCommands: () => ({
      createTask: unavailable,
      pending: () => false,
      create: unavailable,
      rename: unavailable,
      setMembers: unavailable,
      delete: unavailable,
      deleteMany: unavailable,
      saveProperty: unavailable,
      saveProperties: unavailable,
      assignTasks: async () => {
        setAssignments((count) => count + 1);
        return [];
      },
    }),
  };

  return (
    <ProjectsProvider context={context}>
      <main class="relative flex h-dvh min-h-0 flex-col bg-page text-ink">
        <ProjectTasksList
          projectId={project.id}
          projectName={project.name}
          onOpenTask={() => true}
          onCreateTask={
            readOnly ? undefined : () => setCreates((count) => count + 1)
          }
          addTasksAction={
            readOnly ? undefined : <AddProjectTasks project={project} />
          }
        />
        {/* The project detail floats this pill for every tab on touch. */}
        <NewProjectTaskPill
          onCreateTask={
            readOnly ? undefined : () => setCreates((count) => count + 1)
          }
        />
        {/* The Tasks view's own floating pill (MobilePageActionRow), which
            creates a task outside any project. */}
        <FloatRegion region="accessory" priority={-1}>
          <div class="flex justify-end px-(--mobile-chrome-gutter)">
            <MobileCreateButton
              label="Task"
              ariaLabel="New task"
              onClick={() => setOutsideCreates((count) => count + 1)}
            />
          </div>
        </FloatRegion>
        <FloatRegionHost />
        <output hidden data-testid="creates">
          {creates()}
        </output>
        <output hidden data-testid="outside-creates">
          {outsideCreates()}
        </output>
        <output hidden data-testid="assignments">
          {assignments()}
        </output>
      </main>
    </ProjectsProvider>
  );
}

document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme('Macro Light');
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(() => <Fixture />, root);
