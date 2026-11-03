import { type Accessor, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it, vi } from 'vitest';
import type { SavedView } from '../../saved-views/core/saved-view';
import { TASK_DEFAULT_GROUP_BY } from '../constants';
import { DEFAULT_TASK_FACET_SELECTION } from '../filters/task-facets';
import {
  captureTaskSavedView,
  decodeTaskSavedView,
  materializeTaskSavedView,
  readTaskSavedView,
  taskSavedViewsEqual,
} from '../filters/task-saved-view';
import {
  createTasksViewPersistence,
  TASKS_ENTRY_STATE_KEY,
} from '../persistence';
import type { TasksTabSearchParams } from '../tasks-tab-search';
import type { TasksTab, TasksViewState } from '../types';
import { createTaskSavedViewDraft } from './create-task-saved-view-draft';
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

it('restores project view history without retaining task person filters', () => {
  const view = setup();
  view.setSearch('tab', 'my-projects');
  expect(view.state.tab).toBe('my-projects');
  expect(view.state.facets).toEqual(DEFAULT_TASK_FACET_SELECTION);
  expect(view.state.groupBy).toBe('status');
  view.setSearch('tab', 'created-projects');
  expect(view.state.tab).toBe('created-projects');
  view.setSearch('tab', 'my-tasks');
  expect(view.state.tab).toBe('my-tasks');
  expect(view.state.groupBy).toBe('priority');
  expect(view.state.search).toBe('keep this search');
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

it('restores the original date filter when URL controls disappear', () => {
  const view = setup({
    state: {
      dueDate: { type: 'range', start: '2026-10-21', end: '2026-10-28' },
    },
  });
  view.setState('dueDate', { type: 'overdue' });
  view.setSearch({
    dueDate: undefined,
    dueStart: undefined,
    dueEnd: undefined,
  });
  expect(view.state.dueDate).toEqual({
    type: 'range',
    start: '2026-10-21',
    end: '2026-10-28',
  });

  view.setSearch('dueDate', 'any');
  expect(view.state.dueDate).toBeUndefined();
  view.setSearch('dueDate', 'range');
  expect(view.state.dueDate).toBeUndefined();
  view.setSearch({
    dueDate: 'range',
    dueStart: '2026-10-28',
    dueEnd: '2026-10-21',
  });
  expect(view.state.dueDate).toBeUndefined();
});

it('round-trips custom date ranges and due sorts without reversed null placement', () => {
  const view = setup({
    search: {
      dueDate: 'range',
      dueStart: '2026-10-21',
      dueEnd: '2026-10-28',
      sort: 'due_date_earliest',
      sortReversed: 'true',
    },
  });
  expect(view.state.dueDate).toEqual({
    type: 'range',
    start: '2026-10-21',
    end: '2026-10-28',
  });
  expect(view.state.sort).toEqual([
    { id: 'due_date_earliest', reversed: false },
  ]);
  view.setState('dueDate', { type: 'overdue' });
  expect(view.search.dueDate).toBe('overdue');
  expect(view.search.dueStart).toBeUndefined();
  view.setState('dueDate', undefined);
  expect(view.search.dueDate).toBe('any');
  view.setPrimarySort('due_date_latest');
  view.setPrimarySort('due_date_latest');
  expect(view.state.sort).toEqual([{ id: 'due_date_latest', reversed: false }]);
  view.setSearch({
    dueDate: 'range',
    dueStart: '2026-10-28',
    dueEnd: '2026-10-21',
  });
  expect(view.state.dueDate).toBeUndefined();
});
it.each(['board', 'gantt'] as const)(
  'keeps saved %s layout in raw state and URL during mobile fallback',
  (layout) => {
    const [nonListLayoutsEnabled, setNonListLayoutsEnabled] =
      createSignal(true);
    const view = setup({
      state: { layout, savedViewActive: true },
      search: {
        savedView: '10000000-0000-4000-8000-000000000001',
        layout,
      },
      nonListLayoutsEnabled,
    });
    expect(view.state.layout).toBe(layout);
    expect(view.writeSearch).not.toHaveBeenCalled();

    setNonListLayoutsEnabled(false);
    expect(view.state.layout).toBe(layout);
    expect(view.search.layout).toBe(layout);
    expect(view.writeSearch).not.toHaveBeenCalled();

    setNonListLayoutsEnabled(true);
    expect(view.state.layout).toBe(layout);
    expect(view.search.layout).toBe(layout);
  }
);

it('retains saved secondary sorts while synchronizing matching URL controls', () => {
  const savedSort = [
    { id: 'created_at' as const, reversed: true },
    { id: 'viewed_at' as const, reversed: false },
  ];
  const view = setup({
    state: { savedViewActive: true, layout: 'board', sort: savedSort },
    search: {
      savedView: '10000000-0000-4000-8000-000000000001',
      sort: 'created_at',
      sortReversed: 'true',
    },
  });
  expect(view.state.sort).toEqual(savedSort);
  view.setSearch('groupBy', 'date');
  expect(view.state.sort).toEqual(savedSort);
  view.setSearch('layout', 'gantt');
  expect(view.state.sort).toEqual(savedSort);
  view.setSearch('sortReversed', 'true');
  expect(view.state.sort).toEqual(savedSort);
  expect(view.state.layout).toBe('gantt');
});

it('keeps saved scope and draft filters when changing presentation', () => {
  const view = setup({
    state: {
      tab: 'team-tasks',
      savedViewActive: true,
      facets: { priority: ['urgent'] },
    },
    search: {
      tab: 'my-tasks',
      savedView: '10000000-0000-4000-8000-000000000001',
    },
  });
  view.setState('layout', 'board');
  view.setState('groupBy', 'assignee');
  view.setPrimarySort('created_at');
  expect(view.state.tab).toBe('team-tasks');
  expect(view.state.facets).toEqual({ priority: ['urgent'] });
  expect(view.search.savedView).toBe('10000000-0000-4000-8000-000000000001');
});

it('restores the requested built-in scope after leaving a saved view', () => {
  const view = setup({
    state: {
      tab: 'team-tasks',
      savedViewActive: true,
      facets: { priority: ['urgent'] },
    },
    search: { savedView: '10000000-0000-4000-8000-000000000001' },
  });
  view.setSearch({ savedView: undefined, tab: 'created-by-me' });
  view.setState('savedViewActive', false);
  expect(view.state.tab).toBe('created-by-me');
  expect(view.state.facets.priority).toBeUndefined();
});

it('keeps edits reverted during a save until confirmed presentation is explicitly reset', () => {
  const fixture = createRoot((dispose) => {
    disposers.push(dispose);
    const record: SavedView = {
      id: 'saved-view',
      ownerId: 'viewer',
      name: 'Saved view',
      sharedTeamId: null,
      revision: 1,
      config: {
        kind: 'tasks',
        version: 1,
        layout: 'list',
        sort: [{ id: 'updated_at', reversed: false }],
        dueDate: { type: 'overdue' },
        filters: {
          statusOptionIds: [],
          priorityOptionIds: [],
          assignees: [],
          creators: [],
          tags: [],
        },
      },
    };
    const [source, setSource] = createSignal(record);
    const [state, setState] = createStore<TasksViewState>({
      layout: 'list',
      tab: 'team-tasks',
      search: '',
      groupBy: 'none',
      sort: [{ id: 'updated_at' }],
      facets: {},
      collapsedGroupIds: [],
      collapsedSidebarSectionIds: [],
    });
    const draft = createTaskSavedViewDraft({
      source: {
        data: source,
        viewerId: () => 'viewer',
        error: () => undefined,
        loading: () => false,
        refresh: async () => undefined,
      },
      selectedId: () => record.id,
      viewerId: () => 'viewer',
      creating: () => false,
      state,
      facetContext: () => ({ tagPropertyDefinitionByOptionId: new Map() }),
      apply: (settings) => setState(settings),
    });
    return { state, setState, draft, record, setSource };
  });
  expect(fixture.state.dueDate).toEqual({ type: 'overdue' });
  fixture.setState('dueDate', { type: 'range', start: '2026-10-21' });
  fixture.setState('layout', 'board');
  fixture.setState('groupBy', 'assignee');
  const submitted = fixture.draft.capture();
  if (submitted.isErr()) throw new Error(submitted.error);
  const release = fixture.draft.retain();
  fixture.setState('dueDate', { type: 'today' });
  fixture.setState('layout', 'list');
  fixture.setState('groupBy', 'priority');
  const confirmed = { ...fixture.record, revision: 2, config: submitted.value };
  fixture.setSource(confirmed);
  expect(fixture.state.layout).toBe('list');
  expect(fixture.draft.acceptConfirmed(confirmed)).toBe(true);
  release();
  expect(fixture.state.layout).toBe('list');
  expect(fixture.state.groupBy).toBe('priority');
  expect(fixture.draft.view()).toMatchObject({ kind: 'saved', dirty: true });
  fixture.draft.reset();
  expect(fixture.state.layout).toBe('board');
  expect(fixture.state.groupBy).toBe('assignee');
  expect(fixture.state.dueDate).toEqual({ type: 'range', start: '2026-10-21' });
  expect(fixture.draft.view()).toMatchObject({ kind: 'saved', dirty: false });
});

it.each(['my-tasks', 'created-by-me', 'team-tasks'] as const)(
  'compares presentation against the %s base defaults',
  (tab) => {
    const fixture = createRoot((dispose) => {
      disposers.push(dispose);
      const [state, setState] = createStore<TasksViewState>({
        layout: 'list',
        tab,
        search: '',
        groupBy: TASK_DEFAULT_GROUP_BY[tab],
        sort: [{ id: 'updated_at', reversed: false }],
        facets: DEFAULT_TASK_FACET_SELECTION,
        collapsedGroupIds: [],
        collapsedSidebarSectionIds: [],
      });
      const draft = createTaskSavedViewDraft({
        source: {
          data: () => undefined,
          viewerId: () => 'viewer',
          error: () => undefined,
          loading: () => false,
          refresh: async () => undefined,
        },
        selectedId: () => undefined,
        viewerId: () => 'viewer',
        creating: () => false,
        state,
        facetContext: () => ({ tagPropertyDefinitionByOptionId: new Map() }),
        apply: (settings) => setState(settings),
      });
      return { state, setState, draft };
    });
    expect(fixture.draft.view()).toEqual({ kind: 'default', changed: false });
    fixture.setState('groupBy', 'date');
    expect(fixture.draft.view()).toEqual({ kind: 'default', changed: true });
    fixture.setState('groupBy', TASK_DEFAULT_GROUP_BY[tab]);
    expect(fixture.draft.view()).toEqual({ kind: 'default', changed: false });
    fixture.setState('sort', [{ id: 'created_at' }]);
    expect(fixture.draft.view()).toEqual({ kind: 'default', changed: true });
    fixture.setState('sort', [{ id: 'updated_at' }]);
    expect(fixture.draft.view()).toEqual({ kind: 'default', changed: false });
    fixture.setState('dueDate', { type: 'tomorrow' });
    expect(fixture.draft.view()).toEqual({ kind: 'default', changed: true });
    fixture.setState('dueDate', undefined);
    expect(fixture.draft.view()).toEqual({ kind: 'default', changed: false });
    fixture.setState('layout', 'board');
    expect(fixture.draft.view()).toEqual({ kind: 'default', changed: true });
  }
);

it('captures relative due dates and property sorts without losing the saved definition', () => {
  const captured = captureTaskSavedView({
    tab: 'my-tasks',
    facets: { status: ['not-started'] },
    dueDate: { type: 'overdue' },
    groupBy: 'due_date',
    sort: [{ id: 'due_date_earliest' }, { id: 'priority', reversed: true }],
    context: { tagPropertyDefinitionByOptionId: new Map() },
  });
  expect(captured.isOk()).toBe(true);
  if (captured.isErr()) return;
  const restored = materializeTaskSavedView(captured.value);
  expect(restored.dueDate).toEqual({ type: 'overdue' });
  expect(restored.groupBy).toBe('due_date');
  expect(restored.sort).toEqual([
    { id: 'due_date_earliest', reversed: false },
    { id: 'priority', reversed: true },
  ]);
  expect(restored.facets.assignees).toEqual(['@viewer']);
  expect(readTaskSavedView(captured.value).issues).toEqual([]);
  const decoded = decodeTaskSavedView(captured.value);
  expect(decoded.isOk()).toBe(true);
  if (decoded.isOk())
    expect(taskSavedViewsEqual(captured.value, decoded.value)).toBe(true);
});

it('rejects invalid saved ranges but keeps other supported settings on read', () => {
  const captured = captureTaskSavedView({
    tab: 'team-tasks',
    facets: {},
    dueDate: { type: 'range', start: '2026-11-02', end: '2026-11-01' },
    context: { tagPropertyDefinitionByOptionId: new Map() },
  });
  expect(captured.isErr()).toBe(true);
  const valid = captureTaskSavedView({
    tab: 'team-tasks',
    facets: {},
    dueDate: { type: 'range', start: '2026-10-21', end: '2026-10-28' },
    context: { tagPropertyDefinitionByOptionId: new Map() },
  });
  expect(valid.isOk()).toBe(true);
  if (valid.isErr()) return;
  expect(materializeTaskSavedView(valid.value).dueDate).toEqual({
    type: 'range',
    start: '2026-10-21',
    end: '2026-10-28',
  });
  const { config, issues } = readTaskSavedView({
    ...valid.value,
    dueDate: { type: 'range', start: 'invalid', end: '2026-10-28' },
    groupBy: 'due_date',
    sort: [{ id: 'status', reversed: true }],
  });
  expect(issues.map(({ path }) => path.join('.'))).toContain('dueDate');
  expect(materializeTaskSavedView(config)).toMatchObject({
    dueDate: undefined,
    groupBy: 'due_date',
    sort: [{ id: 'status', reversed: true }],
  });
  expect(
    decodeTaskSavedView({ ...valid.value, dueDate: undefined }).isOk()
  ).toBe(true);
  expect(taskSavedViewsEqual(valid.value, config)).toBe(false);
});

it('keeps saved-view date filters out of built-in entry snapshots', () => {
  const { state, setState } = setup({
    state: { savedViewActive: true, dueDate: { type: 'overdue' } },
  });
  const captors = new Map<string, () => unknown>();
  const persistence = createTasksViewPersistence({
    handle: {
      currentEntryState: () => undefined,
      registerEntryStateCaptor: (key, capture) => {
        captors.set(key, capture);
        return () => captors.delete(key);
      },
    },
    userId: () => undefined,
  });
  const storages = Array.isArray(persistence.storages)
    ? persistence.storages
    : [persistence.storages];
  for (const storage of storages) storage.write(state);
  expect(captors.get(TASKS_ENTRY_STATE_KEY)?.()).toMatchObject({
    tab: 'my-tasks',
    dueDate: undefined,
  });

  setState('savedViewActive', false);
  for (const storage of storages) storage.write(state);
  expect(captors.get(TASKS_ENTRY_STATE_KEY)?.()).toMatchObject({
    dueDate: { type: 'overdue' },
  });
  for (const storage of storages) storage.dispose?.();
});
