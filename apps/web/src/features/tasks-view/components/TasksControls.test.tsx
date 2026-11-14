import { getShortcutSheet } from '@core/hotkey/getCommands';
import { useHotKeyRoot } from '@core/hotkey/hotkeys';
import { setActiveScope } from '@core/hotkey/state';
import { registerScope, removeScope } from '@core/hotkey/utils';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TasksControls } from './TasksControls';

const view = await vi.hoisted(async () => {
  const { createStore } = await import('solid-js/store');
  const [state, setState] = createStore({ search: '' });
  return { scope: 'tasks-controls-test-scope', state, setState };
});

vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    splitHotkeyScope: view.scope,
    isPanelActive: () => true,
  }),
}));
// The dropdowns have their own coverage; this suite checks which controls the
// header offers.
vi.mock('@app/components/view-shell', async () => ({
  ListFilterDropdown: () => null,
  ListSortDropdown: (props: {
    label: string;
    open?: boolean;
    triggerRef?: (element: HTMLButtonElement) => void;
  }) => (
    <button
      type="button"
      ref={props.triggerRef}
      aria-expanded={props.open ? 'true' : 'false'}
    >
      {props.label}
    </button>
  ),
  ListGroupDropdown: (props: { label: string }) => (
    <button type="button">{props.label}</button>
  ),
  useViewControlHotkeys: (
    await import('@app/components/view-shell/use-view-control-hotkeys')
  ).useViewControlHotkeys,
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
      get search() {
        return view.state.search;
      },
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

beforeEach(() => {
  registerScope({ parentScopeId: 'global', scopeId: view.scope, type: 'dom' });
  setActiveScope(view.scope);
});

afterEach(() => {
  cleanup();
  view.setState('search', '');
  setActiveScope('global');
  removeScope(view.scope);
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
  view.setState('search', 'brief');
  render(() => <TasksControls />);

  expect(viewOptions().textContent).toBe('Group by');
});

function listsSortShortcut() {
  return getShortcutSheet(view.scope).view.some(
    (entry) => entry.description === 'Sort tasks'
  );
}

function pressSort() {
  const keydown = new KeyboardEvent('keydown', {
    key: 's',
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(keydown);
  document.dispatchEvent(
    new KeyboardEvent('keyup', { key: 's', bubbles: true })
  );
  return keydown;
}

it('lists and runs the sort shortcut only while not searching', () => {
  render(() => {
    useHotKeyRoot();
    return <TasksControls />;
  });
  expect(listsSortShortcut()).toBe(true);

  view.setState('search', 'brief');
  expect(listsSortShortcut()).toBe(false);
  expect(pressSort().defaultPrevented).toBe(false);

  view.setState('search', '');
  expect(listsSortShortcut()).toBe(true);
  expect(pressSort().defaultPrevented).toBe(true);
  expect(
    screen
      .getByRole('button', { name: 'Sort tasks' })
      .getAttribute('aria-expanded')
  ).toBe('true');
});
