import type { ProjectWorkspaceProps } from '@app/features/projects/context/project-workspace';
import type { ProjectDetail } from '@app/features/projects/core/project';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createEffect, createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileProjectWorkspace } from './project-workspace';

const [geometry, setGeometry] = createSignal({ viewport: 640, tasks: 240 });

vi.mock('@solid-primitives/resize-observer', () => ({
  createElementSize: (element: () => HTMLElement | undefined) => {
    const [height, setHeight] = createSignal<number>();
    createEffect(() => {
      const sizes = geometry();
      const node = element();
      if (!node) return;
      if (node.tagName === 'SECTION') setHeight(sizes.tasks);
      else if (node.classList.contains('overflow-y-auto'))
        setHeight(sizes.viewport);
      else setHeight(node.querySelector('h2') ? 56 : 360);
    });
    return {
      get height() {
        return height();
      },
    };
  },
}));
vi.mock('../shared/project-workspace-layout', () => ({
  ProjectWorkspaceLayout: (props: ParentProps) => props.children,
}));
vi.mock('../../project-tasks-provider', () => ({
  ProjectTasksProvider: (props: ParentProps) => props.children,
}));
vi.mock('../shared/project-summary', () => ({
  ProjectSummary: (props: ParentProps) => props.children,
}));
vi.mock('./project-description', () => ({
  MobileProjectDescription: (props: ParentProps) => props.children,
}));
vi.mock('./project-details-action', () => ({
  ProjectDetailsAction: () => null,
}));
vi.mock('../../components/project-progress', () => ({
  ProjectProgress: () => null,
}));
vi.mock('@app/features/tasks-view/components/TasksFilterDrawer', () => ({
  TasksFilterDrawer: () => null,
}));
vi.mock('@app/features/tasks-view/tasks-content', () => ({
  TasksContent: () => <p>Existing task</p>,
}));
vi.mock('../../add-project-tasks', () => ({
  AddProjectTasks: (props: { onCreateTask?: () => void }) => (
    <button onClick={props.onCreateTask}>Add task</button>
  ),
}));

const project = {
  id: 'project',
  name: 'Project',
  access: 'owner',
  taskIds: ['task'],
  ownerId: 'member',
  memberIds: ['member'],
  createdAt: '2026-10-01T12:00:00Z',
  updatedAt: '2026-10-01T12:00:00Z',
} satisfies ProjectDetail;
const source: ProjectWorkspaceProps['source'] = {
  project: () => project,
  properties: () => [],
  loading: () => false,
  error: () => undefined,
  refresh: async () => {},
};

afterEach(() => {
  cleanup();
  setGeometry({ viewport: 640, tasks: 240 });
});

it('keeps Add task available when the task area cannot fill the viewport', () => {
  const createTask = vi.fn();
  render(() => (
    <MobileProjectWorkspace
      project={project}
      source={source}
      commands={{} as ProjectWorkspaceProps['commands']}
      section="overview"
      onOpenTask={() => true}
      onCreateTask={createTask}
      description={<p>Short description</p>}
      discussion={null}
    />
  ));

  expect(screen.getByText('Existing task')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add task' }));
  expect(createTask).toHaveBeenCalledOnce();
});

it('keeps one floating action at rest and after scrolling or resizing', () => {
  setGeometry({ viewport: 640, tasks: 900 });
  render(() => (
    <MobileProjectWorkspace
      project={project}
      source={source}
      commands={{} as ProjectWorkspaceProps['commands']}
      section="overview"
      onOpenTask={() => true}
      onCreateTask={() => {}}
      description={null}
      discussion={null}
    />
  ));

  expect(screen.getAllByRole('button', { name: 'Add task' })).toHaveLength(1);
  const scroller = screen.getByRole('region', { name: 'Tasks' }).parentElement!;
  fireEvent.scroll(scroller, { target: { scrollTop: 360 } });
  expect(screen.getAllByRole('button', { name: 'Add task' })).toHaveLength(1);

  setGeometry({ viewport: 1000, tasks: 900 });
  fireEvent.scroll(scroller, { target: { scrollTop: 0 } });
  expect(screen.getAllByRole('button', { name: 'Add task' })).toHaveLength(1);

  setGeometry({ viewport: 640, tasks: 900 });
  expect(screen.getAllByRole('button', { name: 'Add task' })).toHaveLength(1);
});

it('keeps one floating action and documentation when the project is empty', () => {
  render(() => (
    <MobileProjectWorkspace
      project={{ ...project, taskIds: [] }}
      source={source}
      commands={{} as ProjectWorkspaceProps['commands']}
      section="overview"
      onOpenTask={() => true}
      onCreateTask={() => {}}
      description={null}
      discussion={null}
    />
  ));
  expect(screen.getAllByRole('button', { name: 'Add task' })).toHaveLength(1);
  expect(
    screen.getByText("Add tasks to plan and track this project's work.")
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Documentation' })).toBeTruthy();
});
