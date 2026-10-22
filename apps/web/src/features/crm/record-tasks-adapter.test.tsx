import type { TasksViewProviderProps } from '@app/features/tasks-view/tasks-view-context';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { CrmRecordScope } from './core/record';
import { CrmRecordTasks } from './record-tasks-adapter';

const { openWithSplit, popoverSplit, adaptive } = vi.hoisted(() => ({
  openWithSplit: vi.fn(),
  popoverSplit: vi.fn(),
  adaptive: vi.fn(() => false),
}));

vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit, popoverSplit }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCrmActivity: 'crm',
  isFeatureEnabled: adaptive,
}));
vi.mock('@property/tags/tag-sets-context', () => ({
  TagSetsQueryProvider: (props: ParentProps) => props.children,
}));
vi.mock('@app/features/tasks-view/tasks-view-context', () => ({
  TasksViewProvider: (props: TasksViewProviderProps) => (
    <>
      <button
        type="button"
        onClick={(event) => props.onOpenTask?.({ id: 'task-1' }, { event })}
      >
        Open task
      </button>
      {props.children}
    </>
  ),
  useTasksView: () => ({ state: { search: '' }, setState: vi.fn() }),
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
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
}));
vi.mock('./components/record-section', () => ({
  RecordSection: (props: { actions: JSX.Element }) => props.actions,
}));

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

it.each([false, true])(
  'persists the original CRM context and associations with adaptive=%s',
  (enabled) => {
    adaptive.mockReturnValue(enabled);
    render(() => <CrmRecordTasks scope={scopes[0]} />);
    fireEvent.click(screen.getByRole('button', { name: 'New task' }));
    const params = popoverSplit.mock.calls[0][0].params;
    expect(params.composerContext.key).toBe('crm:contact:contact-1');
    expect(Object.values(params.composerContext.initialPropertyValues)).toEqual(
      expect.arrayContaining([
        {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'contact-1', entity_type: 'CONTACT' }],
        },
        {
          valueType: 'ENTITY',
          refs: [{ entity_id: 'company-1', entity_type: 'COMPANY' }],
        },
      ])
    );
    expect(params.createTask).toBeUndefined();
  }
);

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
