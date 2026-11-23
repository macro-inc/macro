import { createRoot, createSignal } from 'solid-js';
import { beforeEach, expect, it, vi } from 'vitest';
import type { TimeTrackingChange } from '../queries/time-tracking-changes';
import { createTaskTime } from './create-task-time';

const hooks = vi.hoisted(() => ({
  refetch: vi.fn(),
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
    entries: () => [],
    pending: () => false,
    failed: () => false,
    refetch: hooks.refetch,
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

beforeEach(() => {
  hooks.refetch.mockReset();
  setTaskId(undefined);
  createRoot(() => createTaskTime(taskId));
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
