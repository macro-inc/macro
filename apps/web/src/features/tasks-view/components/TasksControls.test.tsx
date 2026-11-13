import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { TasksControls } from './TasksControls';

const view = vi.hoisted(() => ({ search: '' }));

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: 'tasks',
    isPanelActive: () => true,
  }),
}));
// The dropdowns have their own coverage; this suite checks which controls the
// header offers.
vi.mock('@app/components/view-shell', () => ({
  ListFilterDropdown: () => null,
  ListSortDropdown: (props: { label: string }) => (
    <button type="button" data-button>
      {props.label}
    </button>
  ),
  ListGroupDropdown: (props: { label: string }) => (
    <button type="button" data-button>
      {props.label}
    </button>
  ),
  useViewControlHotkeys: () => {},
}));
vi.mock('./TasksFilterDrawer', () => ({ TasksFilterDrawer: () => null }));
vi.mock('./task-due-date-range-dialog', () => ({
  TaskDueDateRangeDialog: () => null,
}));
vi.mock('../filters/use-task-filters', () => ({
  useTaskFilters: () => ({
    activeCount: () => 0,
    groups: () => [],
    isSelected: () => false,
    selectedIds: () => [],
    setSelected: vi.fn(),
    clear: vi.fn(),
    applyDescription: vi.fn(),
    customRange: () => undefined,
    setCustomRange: vi.fn(),
    applyCustomRange: vi.fn(),
  }),
}));
vi.mock('../tasks-view-context', () => ({
  useTasksView: () => ({
    state: {
      search: view.search,
      sort: [],
      layout: 'list',
      groupBy: 'status',
    },
    setPrimarySort: vi.fn(),
    setState: vi.fn(),
    projectsEnabled: () => false,
    ganttEnabled: () => false,
  }),
}));

afterEach(() => {
  cleanup();
  view.search = '';
});

function viewOptions() {
  return screen.getByRole('group', { name: 'Task view options' });
}

it('offers sort and grouping while not searching', () => {
  render(() => <TasksControls />);

  const buttons = within(viewOptions()).getAllByRole('button');
  expect(buttons.map((button) => button.textContent)).toEqual([
    'Sort tasks',
    'Group by',
  ]);
});

it('leaves only grouping in the view options while searching', () => {
  view.search = 'brief';
  render(() => <TasksControls />);

  expect(viewOptions().textContent).toBe('Group by');
});
