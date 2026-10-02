import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Accessor, ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../core/project';
import { AddProjectTasks } from './add-project-tasks';

const mock = vi.hoisted(() => ({ assignTasks: vi.fn() }));
vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/components/Button')),
  ...(await import('@app/components/ui/components/Dialog')),
  ...(await import('@app/components/ui/components/Surface')),
  ...(await import('@app/components/ui/utils/classname')),
  Hotkey: () => null,
}));
vi.mock('@app/components/ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
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
  descriptionDocumentId: 'description',
  ownerId: 'owner',
  memberIds: [],
  access: 'owner',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

it('adds selected tasks and closes only after the request settles', async () => {
  const result = Promise.withResolvers<{ taskId: string }[]>();
  mock.assignTasks.mockReturnValue(result.promise);
  const close = vi.fn();
  render(() => <AddProjectTasks project={project} onClose={close} />);
  expect(screen.getByTestId('excluded').textContent).toBe('linked');
  expect(
    screen.getByText(/Tasks already in another project will move here/)
  ).toBeTruthy();
  fireEvent.click(screen.getByText('Select tasks'));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  expect(mock.assignTasks).toHaveBeenCalledWith('project', ['one', 'two']);
  expect(screen.getByRole('button', { name: 'Cancel' })).toHaveProperty(
    'disabled',
    true
  );
  expect(close).not.toHaveBeenCalled();
  result.resolve([{ taskId: 'one' }, { taskId: 'two' }]);
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it('keeps only failed tasks selected for retry', async () => {
  mock.assignTasks
    .mockResolvedValueOnce([
      { taskId: 'one' },
      { taskId: 'two', error: 'You need edit access to this task.' },
    ])
    .mockResolvedValueOnce([{ taskId: 'two' }]);
  const close = vi.fn();
  render(() => <AddProjectTasks project={project} onClose={close} />);
  fireEvent.click(screen.getByText('Select tasks'));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    '1 task could not be added. You need edit access to this task.'
  );
  expect(screen.getByTestId('selection').textContent).toBe('two');
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 task' }));
  await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(mock.assignTasks).toHaveBeenLastCalledWith('project', ['two']);
});

it('preserves the selection after a request failure and allows canceling', async () => {
  mock.assignTasks.mockRejectedValue(new Error('Offline'));
  const close = vi.fn();
  render(() => <AddProjectTasks project={project} onClose={close} />);
  fireEvent.click(screen.getByText('Select tasks'));
  fireEvent.click(screen.getByRole('button', { name: 'Add 2 tasks' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Offline'
  );
  expect(screen.getByTestId('selection').textContent).toBe('one,two');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(close).toHaveBeenCalledOnce();
});
