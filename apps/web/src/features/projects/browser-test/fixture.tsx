import '@app/index.css';
import { FloatRegionHost } from '@components/app/mobile/float-regions/FloatRegionHost';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
  type ProjectsContext,
  ProjectsProvider,
} from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import {
  ProjectTaskActions,
  ProjectTasksEmptyState,
} from '../views/project-task-actions';

import { CollectionFixture } from './collection-fixture';

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
  throw new Error('Capability unavailable in project task fixture');
};

function Fixture() {
  const [creates, setCreates] = createSignal(0);
  const [assignments, setAssignments] = createSignal('');
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
      assignTasks: async (
        projectId: string | undefined,
        ids: readonly string[]
      ) => {
        setAssignments(`${projectId}: ${ids.join(',')}`);
        return ids.map((taskId) => ({ taskId }));
      },
    }),
  };
  const scenario = new URLSearchParams(location.search).get('scenario');
  return (
    <ProjectsProvider context={context}>
      <main class="relative @container flex h-screen min-h-0 flex-col bg-app text-ink">
        {scenario === 'empty' || scenario === 'readonly' ? (
          <ProjectTasksEmptyState
            project={{
              ...project,
              taskIds: [],
              access: scenario === 'readonly' ? 'view' : 'owner',
            }}
            onCreateTask={
              scenario === 'empty' ? () => setCreates((n) => n + 1) : undefined
            }
          />
        ) : (
          <ProjectTaskActions
            project={project}
            onCreateTask={() => setCreates((n) => n + 1)}
          />
        )}
        <output hidden data-testid="creates">
          {creates()}
        </output>
        <output hidden data-testid="assignments">
          {assignments()}
        </output>
        <FloatRegionHost />
      </main>
    </ProjectsProvider>
  );
}

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');
render(
  () =>
    new URLSearchParams(location.search).get('scenario') === 'collection' ? (
      <CollectionFixture />
    ) : (
      <Fixture />
    ),
  root
);
