import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Accessor, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../core/project';
import {
  ProjectTaskActions,
  ProjectTasksEmptyState,
} from './project-task-actions';

const mock = vi.hoisted(() => ({ assignTasks: vi.fn() }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Button')),
  ...(await import('@app/components/ui/components/ButtonGroup')),
  ...(await import('@app/components/ui/components/Dropdown')),
  ...(await import('@app/components/ui/components/Surface')),
  ...(await import('@app/components/ui/utils/classname')),
  Hotkey: () => null,
}));
vi.mock('@core/component/HoverCard', () => ({
  useIsInsideHoverCard: () => false,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('../context/projects-context', () => ({
  useProjectsContext: () => ({
    createCommands: () => ({ assignTasks: mock.assignTasks }),
  }),
}));
vi.mock('@property/editors/selectors/PropertyEntitySelector', () => ({
  PropertyEntitySelector: (props: {
    config: { excludedIds: Accessor<ReadonlySet<string>> };
    selectedOptions: Accessor<Set<string>>;
    setSelectedOptions(ids: Set<string>): void;
  }) => (
    <>
      <input aria-label="Search tasks" />
      <button
        onClick={() => props.setSelectedOptions(new Set(['one', 'linked']))}
      >
        Select tasks
      </button>
      <output data-testid="excluded">
        {[...props.config.excludedIds()].join(',')}
      </output>
    </>
  ),
}));

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

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('creates through the main action and the menu without assigning an existing task', async () => {
  const create = vi.fn();
  render(() => <ProjectTaskActions project={project} onCreateTask={create} />);
  fireEvent.click(screen.getByRole('button', { name: 'New task' }));
  expect(create).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole('button', { name: 'More task actions' }), {
    key: 'Enter',
  });
  fireEvent.keyDown(screen.getByRole('menuitem', { name: 'New task' }), {
    key: 'Enter',
  });
  expect(create).toHaveBeenCalledTimes(2);
  expect(mock.assignTasks).not.toHaveBeenCalled();
});

it('assigns only unlinked selected tasks from the menu', async () => {
  mock.assignTasks.mockResolvedValue([{ taskId: 'one' }]);
  render(() => <ProjectTaskActions project={project} onCreateTask={vi.fn()} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'More task actions' }), {
    key: 'Enter',
  });
  fireEvent.keyDown(
    screen.getByRole('menuitem', { name: 'Add existing tasks' }),
    { key: 'Enter' }
  );
  expect(screen.getByTestId('excluded').textContent).toBe('linked');
  fireEvent.click(screen.getByRole('button', { name: 'Select tasks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  expect(mock.assignTasks).toHaveBeenCalledWith('project', ['one']);
  await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

it('ignores an assignment result after the project changes', async () => {
  const pending = Promise.withResolvers<{ taskId: string; error?: string }[]>();
  mock.assignTasks.mockReturnValue(pending.promise);
  const [current, setCurrent] = createSignal(project);
  render(() => (
    <ProjectTaskActions project={current()} onCreateTask={vi.fn()} />
  ));
  fireEvent.keyDown(screen.getByRole('button', { name: 'More task actions' }), {
    key: 'Enter',
  });
  fireEvent.keyDown(
    screen.getByRole('menuitem', { name: 'Add existing tasks' }),
    { key: 'Enter' }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Select tasks' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  setCurrent({ ...project, id: 'another', taskIds: [] });
  pending.resolve([{ taskId: 'one', error: 'Old project failed' }]);
  await vi.waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty(
      'disabled',
      false
    )
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('excluded').textContent).toBe('');
});

it('shows both actions in the empty state and hides them without edit access', () => {
  const create = vi.fn();
  render(() => (
    <ProjectTasksEmptyState
      project={{ ...project, taskIds: [] }}
      onCreateTask={create}
    />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'New task' }));
  expect(create).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Add existing tasks' }),
    { key: 'Enter' }
  );
  expect(screen.getByRole('menu')).toBeTruthy();
  cleanup();
  render(() => (
    <ProjectTasksEmptyState
      project={{ ...project, access: 'view', taskIds: [] }}
    />
  ));
  expect(screen.queryByRole('button', { name: 'New task' })).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Add existing tasks' })
  ).toBeNull();
});
