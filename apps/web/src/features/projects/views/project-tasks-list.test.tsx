import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../core/project';
import { ProjectTasksList } from './project-tasks-list';

const source = vi.hoisted(() => ({
  loading: false,
  layout: 'list',
  search: '',
}));

vi.mock('@app/features/tasks-view/tasks-view-context', () => ({
  TasksViewProvider: (props: { children: JSX.Element }) => props.children,
  useTasksView: () => ({
    state: {
      get search() {
        return source.search;
      },
      get layout() {
        return source.layout;
      },
    },
    setState: vi.fn(),
    source: { isLoading: () => source.loading, error: () => undefined },
  }),
}));
vi.mock('@app/features/tasks-view/components/TasksControls', () => ({
  TasksControls: () => null,
}));
vi.mock('@app/features/tasks-view/tasks-content', () => ({
  TasksContent: (props: { emptyContent?: JSX.Element }) =>
    source.layout === 'list' && props.emptyContent ? (
      props.emptyContent
    ) : (
      <div>No tasks in this view.</div>
    ),
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
vi.mock('./project-task-actions', () => ({ ProjectTaskActions: () => null }));
vi.mock('./shared/project-tasks-empty-state', () => ({
  ProjectTasksEmptyState: (props: {
    onCreateTask?: () => void;
    search?: string;
  }) => (
    <div
      data-testid={
        props.search === undefined ? 'empty-project' : 'empty-task-results'
      }
    >
      <h2>
        {props.search === undefined ? 'No tasks yet' : 'No tasks to show'}
      </h2>
      {props.onCreateTask && (
        <button onClick={props.onCreateTask}>New task</button>
      )}
      {props.onCreateTask && <button>Add existing tasks</button>}
    </div>
  ),
}));

beforeEach(() =>
  Object.assign(source, { loading: false, layout: 'list', search: '' })
);
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

it('passes project actions to filtered empty task results', () => {
  const create = vi.fn();
  render(() => (
    <ProjectTasksList
      project={{ ...project, taskIds: ['linked-task'] }}
      projectId="project"
      onOpenTask={() => true}
      onCreateTask={create}
    />
  ));
  expect(screen.getByTestId('empty-task-results')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'New task' }));
  expect(create).toHaveBeenCalledOnce();
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
  expect(screen.getByText('No tasks to show')).toBeTruthy();
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

it.each(['list', 'board', 'gantt'])(
  'uses unfiltered membership before the %s query settles',
  (layout) => {
    source.layout = layout;
    source.loading = true;
    source.search = 'no matching tasks';
    render(() => (
      <ProjectTasksList
        project={project}
        projectId="project"
        onOpenTask={() => true}
      />
    ));
    expect(screen.getByTestId('empty-project')).toBeTruthy();
    expect(screen.queryByText('No tasks in this view.')).toBeNull();
  }
);

it('keeps the filtered-empty message when linked tasks exist', () => {
  source.layout = 'board';
  source.search = 'no matching tasks';
  render(() => (
    <ProjectTasksList
      project={{ ...project, taskIds: ['completed-task'] }}
      projectId="project"
      onOpenTask={() => true}
    />
  ));
  expect(screen.queryByTestId('empty-project')).toBeNull();
  expect(screen.getByText('No tasks in this view.')).toBeTruthy();
});
