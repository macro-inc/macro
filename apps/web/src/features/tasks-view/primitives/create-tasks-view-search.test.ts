import { type Accessor, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import type { TasksTabSearchParams } from '../tasks-tab-search';
import type { TasksTab, TasksViewState } from '../types';
import { createTasksViewSearch } from './create-tasks-view-search';

const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup(
  options: {
    state?: Partial<TasksViewState>;
    search?: Partial<TasksTabSearchParams>;
    scopedTab?: TasksTab;
    enabled?: boolean;
    nonListLayoutsEnabled?: Accessor<boolean>;
  } = {}
) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const [state, setState] = createStore<TasksViewState>({
      layout: 'list',
      tab: 'my-tasks',
      search: 'keep this search',
      groupBy: 'priority',
      sort: [{ id: 'updated_at' }],
      facets: { priority: ['high'] },
      collapsedGroupIds: ['collapsed'],
      collapsedSidebarSectionIds: [],
      ...options.state,
    });
    const [search, setSearch] = createStore<TasksTabSearchParams>({
      tab: 'my-tasks',
      layout: undefined,
      groupBy: undefined,
      sort: undefined,
      sortReversed: undefined,
      ...options.search,
    });
    const writeSearch = vi.fn((patch: Partial<TasksTabSearchParams>) => {
      setSearch(patch);
    });
    const controls = createTasksViewSearch({
      state,
      setState,
      search,
      setSearch: writeSearch,
      tab: () => options.scopedTab ?? search.tab,
      enabled: options.enabled ?? true,
      nonListLayoutsEnabled: options.nonListLayoutsEnabled,
    });

    return { state, search, setSearch, writeSearch, ...controls };
  });
}

it('restores layout and controls from URL history without losing entry-only state', () => {
  const view = setup({
    state: { layout: 'board', groupBy: 'date' },
    search: {
      layout: 'list',
      groupBy: 'assignee',
      sort: 'created_at',
      sortReversed: 'true',
    },
  });

  expect(view.state.layout).toBe('list');
  expect(view.state.groupBy).toBe('assignee');
  expect(view.state.sort).toEqual([{ id: 'created_at', reversed: true }]);
  view.setState('layout', 'board');
  expect(view.search.layout).toBe('board');
  view.setSearch('layout', 'list');
  expect(view.state.layout).toBe('list');
  view.setSearch('layout', 'board');
  expect(view.state.layout).toBe('board');
  view.setSearch('layout', 'list');

  view.setSearch({
    layout: undefined,
    groupBy: undefined,
    sort: undefined,
    sortReversed: undefined,
  });
  expect(view.state.layout).toBe('board');
  expect(view.state.groupBy).toBe('date');
  expect(view.state.sort).toEqual([{ id: 'updated_at' }]);
  expect(view.state.search).toBe('keep this search');
  expect(view.state.facets).toEqual({ priority: ['high'] });
  expect(view.state.collapsedGroupIds).toEqual(['collapsed']);
});

it('keeps project controls independent from the parent Tasks URL and tab', () => {
  const parent = setup({ search: { groupBy: 'priority' } });
  const project = setup({
    state: { tab: 'team-tasks', groupBy: 'status' },
    scopedTab: 'team-tasks',
  });

  project.setState('layout', 'board');
  project.setState('groupBy', 'assignee');
  project.setPrimarySort('created_at');
  project.setPrimarySort('created_at');
  expect(project.state.tab).toBe('team-tasks');
  expect(project.search).toMatchObject({
    layout: 'board',
    groupBy: 'assignee',
    sort: 'created_at',
    sortReversed: 'true',
  });
  expect(parent.state.layout).toBe('list');
  expect(parent.state.groupBy).toBe('priority');
  expect(parent.state.sort).toEqual([{ id: 'updated_at' }]);
  expect(parent.writeSearch).not.toHaveBeenCalled();

  project.setSearch('layout', 'list');
  expect(project.state.layout).toBe('list');
  expect(project.state.tab).toBe('team-tasks');
  parent.setState('layout', 'board');
  expect(project.state.layout).toBe('list');
});

it('leaves embedded entry state and the parent URL untouched without a URL capability', () => {
  const view = setup({
    state: { tab: 'team-tasks', groupBy: 'status' },
    search: { layout: 'board', groupBy: 'assignee', sort: 'created_at' },
    enabled: false,
  });

  expect(view.state.layout).toBe('list');
  expect(view.state.tab).toBe('team-tasks');
  expect(view.state.groupBy).toBe('status');
  view.setState('layout', 'board');
  view.setState('groupBy', 'priority');
  view.setPrimarySort('viewed_at');
  expect(view.state.sort).toEqual([{ id: 'viewed_at', reversed: false }]);
  expect(view.writeSearch).not.toHaveBeenCalled();
  expect(view.search.sort).toBe('created_at');
});

it.each(['board', 'gantt'] as const)(
  'replaces mobile %s URLs with list while preserving task controls and entry state',
  (layout) => {
    const view = setup({
      nonListLayoutsEnabled: () => false,
      search: {
        layout,
        groupBy: 'date',
        sort: 'created_at',
        sortReversed: 'true',
      },
    });

    expect(view.writeSearch).toHaveBeenCalledExactlyOnceWith(
      { layout: 'list' },
      { history: 'replace' }
    );
    expect(view.state.layout).toBe('list');
    expect(view.search).toMatchObject({
      layout: 'list',
      groupBy: 'date',
      sort: 'created_at',
      sortReversed: 'true',
    });
    expect(view.state.groupBy).toBe('date');
    expect(view.state.search).toBe('keep this search');
    expect(view.state.facets).toEqual({ priority: ['high'] });
    expect(view.state.collapsedGroupIds).toEqual(['collapsed']);

    view.setSearch('layout', layout);
    expect(view.state.layout).toBe('list');
    expect(view.search.layout).toBe('list');
    view.setState('layout', layout);
    expect(view.state.layout).toBe('list');
    expect(view.search.layout).toBe('list');
  }
);

it('falls back from restored board entries and from desktop boards when mobile activates', () => {
  const restored = setup({
    state: { layout: 'board' },
    nonListLayoutsEnabled: () => false,
    scopedTab: 'team-tasks',
  });
  expect(restored.state.layout).toBe('list');
  expect(restored.state.tab).toBe('team-tasks');
  expect(restored.writeSearch).toHaveBeenCalledExactlyOnceWith(
    { layout: 'list' },
    { history: 'replace' }
  );

  const [nonListLayoutsEnabled, setNonListLayoutsEnabled] = createSignal(true);
  const desktop = setup({ search: { layout: 'board' }, nonListLayoutsEnabled });
  expect(desktop.state.layout).toBe('board');
  expect(desktop.writeSearch).not.toHaveBeenCalled();

  setNonListLayoutsEnabled(false);
  expect(desktop.state.layout).toBe('list');
  expect(desktop.search.layout).toBe('list');
  setNonListLayoutsEnabled(true);
  expect(desktop.state.layout).toBe('list');
  desktop.setState('layout', 'board');
  expect(desktop.state.layout).toBe('board');
});
