import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../core/project';
import { ProjectTasksList } from './project-tasks-list';

vi.mock('@app/features/tasks-view/tasks-view-context', () => ({
  TasksViewProvider: (props: { children: JSX.Element }) => props.children,
  useTasksView: () => ({
    state: { search: '', layout: 'list' },
    setState: vi.fn(),
    source: { isLoading: () => false, error: () => undefined },
  }),
}));
vi.mock('@app/features/tasks-view/components/TasksControls', () => ({
  TasksControls: () => null,
}));
vi.mock('@app/features/tasks-view/tasks-content', () => ({
  TasksContent: (props: { emptyContent?: JSX.Element }) =>
    props.emptyContent ?? <div>Tasks list</div>,
}));
vi.mock('../components/project-task-search', () => ({
  ProjectTaskSearch: () => null,
}));
vi.mock('../context/projects-context', () => ({
  useProjectsContext: () => ({ createProjectSource: () => ({}) }),
}));
vi.mock('../queries/project-tasks', () => ({
  createProjectTasksDataSource: () => ({}),
}));
vi.mock('./project-task-actions', () => ({
  ProjectTaskActions: () => null,
  ProjectTasksEmptyState: (props: { onCreateTask?: () => void }) => (
    <div data-testid="empty-project">
      <h2>No tasks yet</h2>
      {props.onCreateTask && (
        <button onClick={props.onCreateTask}>New task</button>
      )}
      {props.onCreateTask && <button>Add existing tasks</button>}
    </div>
  ),
}));

afterEach(cleanup);
const project: ProjectDetail = {
  id: 'project',
  name: 'Launch',
  taskIds: [],
  ownerId: 'owner',
  memberIds: [],
  access: 'owner',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

it('shows both empty-project actions and uses the existing creation callback', () => {
  const create = vi.fn();
  render(() => (
    <ProjectTasksList
      project={project}
      projectId="project"
      onOpenTask={() => true}
      onCreateTask={create}
    />
  ));
  expect(screen.getByTestId('empty-project')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'New task' }));
  expect(create).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole('button', { name: 'Add existing tasks' })
  ).toBeTruthy();
});

it('does not show the project empty state for filtered results or read-only access', () => {
  render(() => (
    <ProjectTasksList
      project={{ ...project, taskIds: ['task'] }}
      projectId="project"
      onOpenTask={() => true}
    />
  ));
  expect(screen.queryByTestId('empty-project')).toBeNull();
  expect(screen.getByText('Tasks list')).toBeTruthy();
  cleanup();
  render(() => (
    <ProjectTasksList
      project={project}
      projectId="project"
      onOpenTask={() => true}
    />
  ));
  expect(screen.getByTestId('empty-project')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();
});
