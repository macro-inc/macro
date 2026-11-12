import { makePersistedState } from '@app/lib/persistence';
import { createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, expect, it } from 'vitest';
import {
  createTasksListEntryStorage,
  createTasksViewPersistence,
  TASKS_ENTRY_STATE_KEY,
  TASKS_LIST_ENTRY_STATE_KEY,
  type TasksListStateSnapshot,
} from './persistence';
import type { TasksTab, TasksViewState } from './types';

const DISPOSERS: (() => void)[] = [];
afterEach(() => {
  for (const dispose of DISPOSERS.splice(0)) dispose();
});

function createView(
  entry?: Record<string, unknown>,
  saved = false,
  account: { userId: string | undefined } = { userId: 'viewer-a' }
) {
  return createRoot((dispose) => {
    DISPOSERS.push(dispose);
    const captors = new Map<string, () => unknown>();
    const [savedViewActive, setSavedViewActive] = createSignal(saved);
    const [userId, setUserId] = createSignal(account.userId);
    const persistence = createTasksViewPersistence({
      handle: {
        currentEntryState: () => entry,
        registerEntryStateCaptor: (key, capture) => {
          captors.set(key, capture);
          return () => captors.delete(key);
        },
      },
      userId,
      savedViewActive,
    });
    const [state, setState] = makePersistedState(
      createStore<TasksViewState>({
        tab: 'my-tasks',
        layout: 'list',
        search: '',
        groupBy: 'priority',
        sort: [{ id: 'updated_at' }],
        facets: {},
        dueDate: undefined,
        collapsedGroupIds: [],
        collapsedSidebarSectionIds: ['saved-views'],
      }),
      persistence
    );
    return {
      state,
      setState,
      setUserId,
      setSavedViewActive,
      restoreTab: persistence.restoreTab,
      clearTabs: persistence.clearTabs,
      capture: () => ({
        [TASKS_ENTRY_STATE_KEY]: captors.get(TASKS_ENTRY_STATE_KEY)?.(),
      }),
      captors,
      dispose,
    };
  });
}

it('keeps filters, dates, presentation, local search and collapsed groups independent per tab', () => {
  const view = createView();
  view.setState({
    facets: { status: ['in-progress'], tags: ['tag-1'] },
    dueDate: { type: 'range', start: '2026-10-01', end: '2026-10-07' },
    layout: 'board',
    groupBy: 'assignee',
    sort: [{ id: 'priority', reversed: true }, { id: 'updated_at' }],
    search: 'local search',
    collapsedGroupIds: ['assignee-1'],
  });
  expect(view.restoreTab(view.state, 'team-tasks')).toBeUndefined();
  view.setState({
    tab: 'team-tasks',
    facets: { status: ['completed'] },
    dueDate: { type: 'overdue' },
    layout: 'list',
    groupBy: 'status',
    sort: [{ id: 'created_at' }],
    search: '',
    collapsedGroupIds: ['completed'],
  });

  const mine = view.restoreTab(view.state, 'my-tasks');
  expect(mine).toMatchObject({
    tab: 'my-tasks',
    facets: { status: ['in-progress'], tags: ['tag-1'] },
    dueDate: { type: 'range', start: '2026-10-01', end: '2026-10-07' },
    layout: 'board',
    groupBy: 'assignee',
    sort: [{ id: 'priority', reversed: true }, { id: 'updated_at' }],
    search: 'local search',
    collapsedGroupIds: ['assignee-1'],
    collapsedSidebarSectionIds: ['saved-views'],
  });
  const all = view.restoreTab(view.state, 'team-tasks');
  expect(all).toMatchObject({
    facets: { status: ['completed'] },
    dueDate: { type: 'overdue' },
    search: '',
    groupBy: 'status',
  });
});

it('carries every tab through the existing captor across disposal and entry restore', () => {
  const view = createView();
  view.setState('facets', { status: ['in-progress'] });
  view.setState({ tab: 'team-tasks', facets: { priority: ['high'] } });
  const captured = view.capture();
  view.setState('facets', { priority: ['low'] });
  view.dispose();
  expect(view.captors.size).toBe(0);

  const restored = createView(captured);
  expect(restored.state).toMatchObject({
    tab: 'team-tasks',
    facets: { priority: ['high'] },
  });
  expect(restored.restoreTab(restored.state, 'my-tasks')).toMatchObject({
    facets: { status: ['in-progress'] },
  });
  expect(restored.restoreTab(restored.state, 'team-tasks')).toMatchObject({
    facets: { priority: ['high'] },
  });
  const independent = createView();
  expect(
    independent.restoreTab(independent.state, 'team-tasks')
  ).toBeUndefined();
});

it('excludes temporary saved-view filters and dates without overwriting built-in tabs', () => {
  const view = createView();
  view.setState({
    facets: { status: ['in-progress'] },
    dueDate: { type: 'today' },
  });
  view.setSavedViewActive(true);
  view.setState({
    tab: 'team-tasks',
    facets: { status: ['completed'] },
    dueDate: { type: 'overdue' },
    search: 'temporary',
  });
  const entry = view.capture();
  expect(entry[TASKS_ENTRY_STATE_KEY]).toMatchObject({
    facets: { status: ['in-progress'] },
    dueDate: { type: 'today' },
    search: '',
  });
  expect(view.restoreTab(view.state, 'team-tasks')).toBeUndefined();
  expect(view.restoreTab(view.state, 'my-tasks')).toMatchObject({
    facets: { status: ['in-progress'] },
    dueDate: { type: 'today' },
  });
  view.dispose();
  const restored = createView(entry);
  expect(restored.restoreTab(restored.state, 'my-tasks')).toMatchObject({
    facets: { status: ['in-progress'] },
    dueDate: { type: 'today' },
  });
});

it('releases tab snapshots when the account scope changes', () => {
  const view = createView();
  view.setState({ tab: 'team-tasks', facets: { status: ['completed'] } });
  view.clearTabs();
  expect(view.restoreTab(view.state, 'team-tasks')).toBeUndefined();
});

it('rejects entry snapshots from another account when the view remounts', () => {
  const original = createView();
  original.setState({
    facets: { status: ['in-progress'] },
    search: 'account-a-search',
  });
  original.setState({
    tab: 'team-tasks',
    facets: { status: ['completed'] },
    dueDate: { type: 'overdue' },
    layout: 'board',
    groupBy: 'assignee',
    sort: [{ id: 'priority', reversed: true }],
    collapsedGroupIds: ['account-a-group'],
  });
  const entry = original.capture();
  original.dispose();

  const restored = createView(entry, false, { userId: 'viewer-b' });
  expect(restored.state).toMatchObject({
    tab: 'my-tasks',
    layout: 'list',
    facets: {},
    dueDate: undefined,
    search: '',
    groupBy: 'priority',
    sort: [{ id: 'updated_at' }],
    collapsedGroupIds: [],
  });
  expect(restored.restoreTab(restored.state, 'my-tasks')).toEqual({
    ...restored.state,
  });
  expect(restored.restoreTab(restored.state, 'team-tasks')).toBeUndefined();
});

it('keeps the view snapshot owner until the account reset runs', () => {
  const view = createView();
  view.setState('facets', { status: ['completed'] });
  view.setUserId('viewer-b');
  const captured = view.capture();
  expect(captured[TASKS_ENTRY_STATE_KEY]).toMatchObject({ userId: 'viewer-a' });
  const remounted = createView(captured, false, { userId: 'viewer-b' });
  expect(remounted.state.facets).toEqual({});

  view.clearTabs();
  view.setState('facets', { status: ['in-progress'] });
  expect(view.capture()[TASKS_ENTRY_STATE_KEY]).toMatchObject({
    userId: 'viewer-b',
    facets: { status: ['in-progress'] },
  });
});

it.each([undefined, 'viewer-a'])(
  'rejects snapshot owner %s while account identity is unresolved',
  (userId) => {
    const restored = createView(
      {
        [TASKS_ENTRY_STATE_KEY]: {
          version: 1,
          userId,
          tab: 'team-tasks',
          facets: { status: ['completed'] },
        },
      },
      false,
      { userId: undefined }
    );
    expect(restored.state.tab).toBe('my-tasks');
    expect(restored.state.facets).toEqual({});
    expect(restored.restoreTab(restored.state, 'team-tasks')).toBeUndefined();
  }
);

it('captures live list position before switching and restores each tab on return and remount', () => {
  let tab: TasksTab | undefined = 'my-tasks';
  let current: TasksListStateSnapshot = {
    focusKey: 'task-1',
    scrollOffset: 180,
  };
  const captors = new Map<string, () => unknown>();
  let entry: Record<string, unknown> = {};
  const handle = {
    currentEntryState: () => entry,
    registerEntryStateCaptor: (key: string, capture: () => unknown) => {
      captors.set(key, capture);
      return () => captors.delete(key);
    },
  };
  const storage = createTasksListEntryStorage(handle, {
    tab: () => tab,
    userId: () => 'viewer-a',
  });
  storage.initialize?.(current, () => current);
  // The live virtualizer changes without a store write; the entry captor must
  // still read the latest position before the tab changes.
  current = { focusKey: 'task-2', scrollOffset: 360 };
  entry = {
    [TASKS_LIST_ENTRY_STATE_KEY]: captors.get(TASKS_LIST_ENTRY_STATE_KEY)?.(),
  };
  tab = 'team-tasks';
  current = { focusKey: 'task-3', scrollOffset: 720 };
  storage.write(current);
  expect(storage.restoreTab(current, 'my-tasks')).toEqual({
    focusKey: 'task-2',
    scrollOffset: 360,
  });
  entry = {
    [TASKS_LIST_ENTRY_STATE_KEY]: captors.get(TASKS_LIST_ENTRY_STATE_KEY)?.(),
  };
  storage.dispose?.();

  tab = 'my-tasks';
  const restored = createTasksListEntryStorage(handle, {
    tab: () => tab,
    userId: () => 'viewer-a',
  });
  expect(restored.restore(current)).toEqual({
    focusKey: 'task-2',
    scrollOffset: 360,
  });
  expect(restored.restoreTab(current, 'team-tasks')).toEqual({
    focusKey: 'task-3',
    scrollOffset: 720,
  });
  restored.dispose?.();

  tab = undefined;
  const savedView = createTasksListEntryStorage(handle, {
    tab: () => tab,
    userId: () => 'viewer-a',
  });
  expect(savedView.restore(current)).toEqual({
    focusKey: undefined,
    scrollOffset: 0,
  });
  tab = 'my-tasks';
  expect(savedView.restoreTab(current, 'my-tasks')).toEqual({
    focusKey: 'task-2',
    scrollOffset: 360,
  });
  expect(savedView.restoreTab(current, 'team-tasks')).toEqual({
    focusKey: 'task-3',
    scrollOffset: 720,
  });
  savedView.dispose?.();

  const otherAccount = createTasksListEntryStorage(handle, {
    tab: () => tab,
    userId: () => 'viewer-b',
  });
  expect(otherAccount.restore(current)).toEqual({
    focusKey: undefined,
    scrollOffset: 0,
  });
  expect(otherAccount.restoreTab(current, 'team-tasks')).toEqual({
    focusKey: undefined,
    scrollOffset: 0,
  });
  otherAccount.dispose?.();
});

it('captures defaults rather than temporary settings on a direct saved-view entry', () => {
  const view = createView(undefined, true);
  view.setState({
    tab: 'team-tasks',
    layout: 'board',
    groupBy: 'assignee',
    sort: [{ id: 'created_at', reversed: true }],
    facets: { status: ['completed'] },
    dueDate: { type: 'overdue' },
    collapsedGroupIds: ['temporary-group'],
    search: 'temporary',
  });
  expect(view.capture()[TASKS_ENTRY_STATE_KEY]).toMatchObject({
    tab: 'my-tasks',
    layout: 'list',
    groupBy: 'priority',
    sort: [{ id: 'updated_at' }],
    dueDate: undefined,
    search: '',
    collapsedGroupIds: [],
    tabs: {},
  });
  expect(view.restoreTab(view.state, 'team-tasks')).toBeUndefined();
});

it('does not relabel an old live list position before the account reset runs', () => {
  createRoot((dispose) => {
    DISPOSERS.push(dispose);
    let userId = 'viewer-a';
    let capture: (() => unknown) | undefined;
    let current: TasksListStateSnapshot = {
      focusKey: 'task-a',
      scrollOffset: 360,
    };
    const storage = createTasksListEntryStorage(
      {
        currentEntryState: () => undefined,
        registerEntryStateCaptor: (_key, getter) => {
          capture = getter;
          return () => {};
        },
      },
      { tab: () => 'my-tasks', userId: () => userId }
    );
    storage.initialize?.(current, () => current);
    userId = 'viewer-b';
    expect(capture?.()).toMatchObject({ userId: 'viewer-b', scrollOffset: 0 });
    expect(capture?.()).not.toHaveProperty('focusKey');

    storage.clearTabs();
    current = { focusKey: 'task-b', scrollOffset: 100 };
    storage.write(current);
    expect(capture?.()).toMatchObject({
      userId: 'viewer-b',
      scrollOffset: 100,
      focusKey: 'task-b',
    });
    storage.dispose?.();
  });
});
