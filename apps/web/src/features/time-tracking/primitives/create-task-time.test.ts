import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import type { TimeTrackingChange } from '../queries/time-tracking-changes';
import { createTaskTime } from './create-task-time';

const hooks = vi.hoisted(() => ({
  refetch: vi.fn(),
  firstPage: [] as { id: string }[],
  firstCursor: undefined as string | undefined,
  pages: {} as Record<string, { entries: { id: string }[]; next?: string }>,
  onChange: undefined as
    | ((change: TimeTrackingChange) => Promise<unknown>)
    | undefined,
  onReconnect: undefined as (() => Promise<unknown>) | undefined,
}));

vi.mock('../context/time-tracking-context', () => ({
  useTimeTracking: () => ({
    client: () => ({}),
    cacheHost: () => undefined,
    viewerId: () => 'macro|author@example.com',
  }),
}));
vi.mock('../queries/time-entries', () => ({
  createTaskTimeEntriesQuery: () => ({
    entries: () => hooks.firstPage,
    nextCursor: () => hooks.firstCursor,
    pending: () => false,
    failed: () => false,
    refetch: hooks.refetch,
  }),
  createTaskTimeEntriesAfterQuery: (
    _taskId: unknown,
    after: () => string | undefined
  ) => ({
    entries: () => hooks.pages[after() ?? '']?.entries ?? [],
    nextCursor: () => hooks.pages[after() ?? '']?.next,
    pending: () => false,
  }),
  logTime: vi.fn(),
  updateTimeEntry: vi.fn(),
  deleteTimeEntry: vi.fn(),
}));
vi.mock('../queries/time-tracking-changes', () => ({
  refreshOnTimeTrackingChanges: (
    onChange: (change: TimeTrackingChange) => Promise<unknown>,
    onReconnect: () => Promise<unknown>
  ) => {
    hooks.onChange = onChange;
    hooks.onReconnect = onReconnect;
  },
}));

const [taskId, setTaskId] = createSignal<string | undefined>();

let time: ReturnType<typeof createTaskTime>;

beforeEach(() => {
  hooks.refetch.mockReset();
  hooks.firstPage = [];
  hooks.firstCursor = undefined;
  hooks.pages = {};
  setTaskId(undefined);
  time = createRoot(() => createTaskTime(taskId));
});

it('reads older pages on request, without repeats, until there are none', () => {
  setTaskId('task-1');
  hooks.firstPage = [{ id: 'a' }, { id: 'b' }];
  hooks.firstCursor = 'after-b';
  hooks.pages = {
    'after-b': { entries: [{ id: 'b' }, { id: 'c' }], next: 'after-c' },
    'after-c': { entries: [{ id: 'd' }] },
  };
  expect(time.hasOlder()).toBe(true);
  time.showOlder();
  expect(time.entries().map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  time.showOlder();
  expect(time.entries().map((entry) => entry.id)).toEqual(['a', 'b', 'c', 'd']);
  expect(time.hasOlder()).toBe(false);
  setTaskId('task-2');
  expect(time.entries().map((entry) => entry.id)).toEqual(['a', 'b']);
});

it('re-reads entries when another session changes this task', async () => {
  setTaskId('task-1');
  await hooks.onChange?.({ timer: false, taskId: 'task-2' });
  expect(hooks.refetch).not.toHaveBeenCalled();
  await hooks.onChange?.({ timer: true, taskId: 'task-1' });
  expect(hooks.refetch).toHaveBeenCalledOnce();
});

it('reads nothing on a push or reconnect before the panel opens', async () => {
  await hooks.onChange?.({ timer: false, taskId: 'task-1' });
  await hooks.onReconnect?.();
  expect(hooks.refetch).not.toHaveBeenCalled();
  setTaskId('task-1');
  await hooks.onReconnect?.();
  expect(hooks.refetch).toHaveBeenCalledOnce();
});
