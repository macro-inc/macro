import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectPicker } from './project-picker';

const mock = vi.hoisted(() => ({
  assignTasks: vi.fn(),
  failure: vi.fn(),
}));

vi.mock('@ui', async () => ({
  ...(await import('@app/components/ui/utils/classname')),
  Hotkey: () => null,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mock.failure },
}));
// Cut the selector's property-utils import graph, which reaches the editor.
vi.mock('@property/utils', () => ({ useSearchInputFocus: () => {} }));
vi.mock('@property/utils/errorHandling', () => ({ ERROR_MESSAGES: {} }));
vi.mock('@property/component/propertyValue', () => ({
  PropertyValueIcon: () => null,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('../context/projects-context', () => ({
  useProjectsContext: () => ({
    createCollectionSource: () => ({
      rows: () => [
        { project: { id: 'editable', name: 'Editable', access: 'edit' } },
        { project: { id: 'readonly', name: 'Read only', access: 'view' } },
      ],
      loading: () => false,
      error: () => undefined,
      hasMore: () => false,
      loadingMore: () => false,
    }),
    createCommands: () => ({ assignTasks: mock.assignTasks }),
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('lists only projects the user can add tasks to', () => {
  render(() => <ProjectPicker taskIds={['task']} onClose={() => {}} />);
  expect(screen.getByText('No project')).toBeTruthy();
  expect(screen.getByText('Editable')).toBeTruthy();
  expect(screen.queryByText('Read only')).toBeNull();
});

it('closes, then assigns only the given tasks', async () => {
  mock.assignTasks.mockResolvedValue([{ taskId: 'task' }]);
  const close = vi.fn();
  render(() => <ProjectPicker taskIds={['task']} onClose={close} />);
  fireEvent.click(screen.getByText('Editable'));
  expect(close).toHaveBeenCalledOnce();
  expect(mock.assignTasks).toHaveBeenCalledWith('editable', ['task']);
  await Promise.resolve();
  expect(mock.failure).not.toHaveBeenCalled();
});

it('assigns every selected task after the picker closes', async () => {
  mock.assignTasks.mockResolvedValue([
    { taskId: 'task-a' },
    { taskId: 'task-b' },
  ]);
  const [assigning, setAssigning] = createSignal<{ ids: string[] } | undefined>(
    { ids: ['task-a', 'task-b'] }
  );

  render(() => (
    <Show when={assigning()}>
      {(current) => (
        <ProjectPicker
          taskIds={current().ids}
          onClose={() => setAssigning(undefined)}
        />
      )}
    </Show>
  ));

  fireEvent.click(screen.getByText('Editable'));
  await vi.waitFor(() =>
    expect(mock.assignTasks).toHaveBeenCalledWith('editable', [
      'task-a',
      'task-b',
    ])
  );
  expect(mock.failure).not.toHaveBeenCalled();
});

it('clears the project and reports per-task failures', async () => {
  mock.assignTasks.mockResolvedValue([
    { taskId: 'task', error: 'You need edit access to this task.' },
  ]);
  render(() => <ProjectPicker taskIds={['task']} onClose={() => {}} />);
  fireEvent.click(screen.getByText('No project'));
  expect(mock.assignTasks).toHaveBeenCalledWith(undefined, ['task']);
  await vi.waitFor(() =>
    expect(mock.failure).toHaveBeenCalledWith('Could not set project', {
      subtext: 'You need edit access to this task.',
    })
  );
});
