import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { type Accessor, createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AddProjectTasks } from '../add-project-tasks';
import type { ProjectDetail } from '../core/project';

const mock = vi.hoisted(() => ({ assignTasks: vi.fn(), touch: false }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Button')),
  ...(await import('@app/components/ui/components/Dropdown')),
  ...(await import('@app/components/ui/components/Surface')),
  ...(await import('@app/components/ui/components/PillButton')),
  ...(await import('@app/components/ui/utils/classname')),
  Hotkey: () => null,
}));

vi.mock('@components/app/mobile/float-regions/FloatRegion', () => ({
  FloatRegion: (props: ParentProps) => props.children,
}));
vi.mock('@core/component/HoverCard', () => ({
  useIsInsideHoverCard: () => false,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mock.touch,
}));
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
beforeEach(() => {
  mock.touch = false;
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
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

it('keeps a late answer for one project out of the next project', async () => {
  const result = Promise.withResolvers<{ taskId: string; error?: string }[]>();
  mock.assignTasks.mockReturnValue(result.promise);
  const [current, setCurrent] = createSignal(project);
  render(() => <AddProjectTasks project={current()} />);
  fireEvent.keyDown(
    screen.getByRole('button', { name: 'Add existing tasks' }),
    { key: 'Enter' }
  );
  fireEvent.click(screen.getByText('Select tasks'));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  setCurrent({ ...project, id: 'next', name: 'Next', taskIds: [] });
  result.resolve([
    { taskId: 'one' },
    { taskId: 'two', error: 'You need edit access to this task.' },
  ]);
  await result.promise;
  await Promise.resolve();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByTestId('selection').textContent).toBe('');
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty(
    'disabled',
    false
  );
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

it('keeps phone picker actions reachable and confirms the draft selection', async () => {
  mock.touch = true;
  mock.assignTasks.mockResolvedValue([{ taskId: 'one' }, { taskId: 'two' }]);
  const style = document.createElement('style');
  style.textContent =
    '[data-corvu-drawer-content], .mobile-create-menu, .mobile-create-menu-overlay { transition-duration: 0s; animation-name: none !important; }';
  document.head.append(style);
  render(() => <AddProjectTasks project={project} inline />);
  fireEvent.click(screen.getByRole('button', { name: 'Task' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add existing tasks' }));
  const sheet = await screen.findByRole('dialog', {
    name: 'Add existing tasks',
  });
  fireEvent.transitionEnd(sheet);
  sheet.scrollTo = vi.fn();
  const add = screen.getByRole('button', { name: 'Add 0 tasks' });
  expect(add).toHaveProperty('disabled', true);
  expect(add.closest('[data-drawer-scroll-body]')).toBeNull();
  fireEvent.click(screen.getByText('Select tasks'));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  expect(mock.assignTasks).toHaveBeenCalledWith('project', ['one', 'two']);
  await vi.waitFor(() => expect(sheet.hasAttribute('data-open')).toBe(false));
  style.remove();
});
