import '@app/index.css';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
  type ProjectsContext,
  ProjectsProvider,
} from '../../context/projects-context';
import type { ProjectDetail } from '../../core/project';
import { AddProjectTasks } from '../../views/add-project-tasks';
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

function Fixture() {
  const [creates, setCreates] = createSignal(0);
  const [assignments, setAssignments] = createSignal(0);
  const context: ProjectsContext = {
    userId: () => 'owner',
    createCollectionSource: unavailable,
    createProjectSource: unavailable,
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
      <main class="flex h-dvh min-h-0 flex-col bg-page text-ink">
        <ProjectTasksList
          projectId={project.id}
          projectName={project.name}
          onOpenTask={() => true}
          onCreateTask={() => setCreates((count) => count + 1)}
          addTasksAction={<AddProjectTasks project={project} />}
        />
        <output hidden data-testid="creates">
          {creates()}
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
