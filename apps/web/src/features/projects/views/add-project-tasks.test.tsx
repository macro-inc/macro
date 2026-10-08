import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Accessor, ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../core/project';
import { AddProjectTasks } from './add-project-tasks';

const mock = vi.hoisted(() => ({ assignTasks: vi.fn() }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Button')),
  ...(await import('@app/components/ui/components/Dropdown')),
  ...(await import('@app/components/ui/components/Surface')),
  ...(await import('@app/components/ui/utils/classname')),
  Hotkey: () => null,
}));
vi.mock('@app/components/ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
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
      <button onClick={() => props.setSelectedOptions(new Set(['one', 'two']))}>
        Select tasks
      </button>
      <output data-testid="selection">
        {[...props.selectedOptions()].join(',')}
      </output>
      <output data-testid="excluded">
        {[...props.config.excludedIds()].join(',')}
      </output>
    </>
  ),
}));
beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
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

it('adds selected tasks and closes only after the request settles', async () => {
  const result = Promise.withResolvers<{ taskId: string }[]>();
  mock.assignTasks.mockReturnValue(result.promise);
  render(() => <AddProjectTasks project={project} />);
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Add existing tasks' }),
    { key: 'Enter' }
  );
  expect(screen.getByTestId('excluded').textContent).toBe('linked');
  fireEvent.click(screen.getByText('Select tasks'));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  expect(mock.assignTasks).toHaveBeenCalledWith('project', ['one', 'two']);
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty(
    'disabled',
    true
  );
  expect(screen.getByRole('menu')).toBeTruthy();
  result.resolve([{ taskId: 'one' }, { taskId: 'two' }]);
  await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

it('keeps only failed tasks selected for retry', async () => {
  mock.assignTasks
    .mockResolvedValueOnce([
      { taskId: 'one' },
      { taskId: 'two', error: 'You need edit access to this task.' },
    ])
    .mockResolvedValueOnce([{ taskId: 'two' }]);
  render(() => <AddProjectTasks project={project} />);
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Add existing tasks' }),
    { key: 'Enter' }
  );
  fireEvent.click(screen.getByText('Select tasks'));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    '1 task could not be added. You need edit access to this task.'
  );
  expect(screen.getByTestId('selection').textContent).toBe('two');
  expect(screen.getByRole('menu')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 task' }));
  await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(mock.assignTasks).toHaveBeenLastCalledWith('project', ['two']);
});

it('preserves the selection after a request failure and allows canceling', async () => {
  mock.assignTasks.mockRejectedValue(new Error('Offline'));
  render(() => <AddProjectTasks project={project} />);
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Add existing tasks' }),
    { key: 'Enter' }
  );
  fireEvent.click(screen.getByText('Select tasks'));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Offline'
  );
  expect(screen.getByTestId('selection').textContent).toBe('one,two');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('menu')).toBeNull();
});

it('opens an anchored task dropdown and dismisses without assigning', () => {
  render(() => <AddProjectTasks project={project} />);
  const trigger = screen.getByRole('button', { name: 'Add existing tasks' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getByRole('menu')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByText('Select tasks'));
  fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(mock.assignTasks).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getByTestId('selection').textContent).toBe('');
});
