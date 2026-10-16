import type { TasksViewProviderProps } from '@app/features/tasks-view/tasks-view-context';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmRecordScope } from './core/record';
import { CrmRecordTasks } from './record-tasks-adapter';

const { openWithSplit } = vi.hoisted(() => ({ openWithSplit: vi.fn() }));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit }),
}));
vi.mock('@property/tags/tag-sets-context', () => ({
  TagSetsQueryProvider: (props: ParentProps) => props.children,
}));
vi.mock('@app/features/tasks-view/tasks-view-context', () => ({
  TasksViewProvider: (props: TasksViewProviderProps) => (
    <button
      type="button"
      onClick={(event) => props.onOpenTask?.({ id: 'task-1' }, { event })}
    >
      Open task
    </button>
  ),
}));
vi.mock('@app/features/tasks-view/components/TasksControls', () => ({
  TasksControls: () => null,
}));
vi.mock('@app/features/tasks-view/components/task-list/TaskList', () => ({
  TaskList: () => null,
}));
vi.mock('@app/features/tasks-view/queries/use-tasks-query', () => ({
  useTasksDataSource: vi.fn(),
}));
vi.mock('@block-md/util/taskComposerProperties', () => ({
  createTaskWithProperties: vi.fn(),
}));
vi.mock('@ui', () => ({ Button: () => null }));
vi.mock('./components/record-section', () => ({ RecordSection: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const scopes: CrmRecordScope[] = [
  {
    type: 'contact',
    id: 'contact-1',
    email: 'phil@example.com',
    companyId: 'company-1',
  },
  { type: 'company', id: 'company-1', domains: ['example.com'] },
];

it.each(scopes)('opens a task from a $type in the task view', (scope) => {
  render(() => <CrmRecordTasks scope={scope} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open task' }));
  expect(openWithSplit).toHaveBeenCalledExactlyOnceWith(
    { type: 'task', id: 'task-1' },
    { preferNewSplit: false }
  );
});

it('preserves the request to open a task in a new split', () => {
  render(() => <CrmRecordTasks scope={scopes[0]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open task' }), {
    shiftKey: true,
  });
  expect(openWithSplit).toHaveBeenCalledExactlyOnceWith(
    { type: 'task', id: 'task-1' },
    { preferNewSplit: true }
  );
});
