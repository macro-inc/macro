import type { TaskEntityWithProperties } from '@entity';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const logs = vi.hoisted(() => ({ entries: [] as string[], trace: [''] }));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: {
    info: (message: string) => logs.entries.push(`${logs.trace[0]}:${message}`),
    warn: (message: string) => logs.entries.push(`${logs.trace[0]}:${message}`),
  },
}));

import { createPendingProjectTasks } from './pending-project-tasks';

/** A create's trace: what runs in it is logged under its name. */
const trace = (name: string) => ({
  run<T>(operation: () => T): T {
    logs.trace.unshift(name);
    try {
      return operation();
    } finally {
      logs.trace.shift();
    }
  },
});

const task = (id: string): TaskEntityWithProperties => ({
  type: 'document',
  fileType: 'md',
  id,
  name: id,
  ownerId: 'viewer',
  subType: { type: 'task', is_completed: false },
  properties: [],
});

const shown = (
  pending: ReturnType<typeof createPendingProjectTasks>,
  projectId = 'project'
) =>
  pending
    .tasks(projectId)
    .map(({ entity, pending }) => `${entity.id}${pending ? '…' : ''}`);

beforeEach(() => {
  vi.useFakeTimers();
  logs.entries = [];
});
afterEach(() => {
  vi.useRealTimers();
});

it('settles creates in whatever order the server answers them', () => {
  createRoot((dispose) => {
    const pending = createPendingProjectTasks({ retentionMs: 1_000 });
    const first = pending.begin('project', task('temp-1'));
    const second = pending.begin('project', task('temp-2'));
    pending.begin('other', task('temp-3'));
    expect(shown(pending)).toEqual(['temp-1…', 'temp-2…']);

    second.confirm('task-2');
    first.fail();
    expect(shown(pending)).toEqual(['task-2']);

    // A late answer for a failed create changes nothing.
    first.confirm('task-1');
    expect(shown(pending)).toEqual(['task-2']);

    // A created task its project rejected leaves, with its timer.
    second.fail();
    expect(shown(pending)).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });
});

it('releases a confirmed task once listed, and only a confirmed one', () => {
  createRoot((dispose) => {
    const pending = createPendingProjectTasks({ retentionMs: 1_000 });
    const created = pending.begin('project', task('temp-1'));
    pending.begin('project', task('temp-2'));
    created.confirm('task-1');

    pending.release(['task-1', 'temp-2']);
    expect(shown(pending)).toEqual(['temp-2…']);
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });
});

it('reads the project once more, then drops a task the list never shows', async () => {
  let answer = () => {};
  const beforeExpire = vi.fn(
    () => new Promise<void>((resolve) => (answer = resolve))
  );
  const { pending, dispose } = createRoot((dispose) => ({
    pending: createPendingProjectTasks({ retentionMs: 1_000, beforeExpire }),
    dispose,
  }));
  pending.begin('project', task('temp')).confirm('task');
  vi.advanceTimersByTime(999);
  expect(shown(pending)).toEqual(['task']);
  vi.advanceTimersByTime(1);
  expect(beforeExpire).toHaveBeenCalledWith('project');
  // The read may list it, which releases it; it stays until the read ends.
  expect(shown(pending)).toEqual(['task']);
  answer();
  await vi.waitFor(() => expect(shown(pending)).toEqual([]));
  dispose();
});

it('starts no timer for a task already gone when its create returns', () => {
  createRoot((dispose) => {
    const pending = createPendingProjectTasks({ retentionMs: 1_000 });
    const failed = pending.begin('project', task('temp'));
    failed.fail();
    failed.confirm('task');
    expect(vi.getTimerCount()).toBe(0);

    const late = pending.begin('project', task('temp-2'));
    dispose();
    late.confirm('task-2');
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('clears its timers when its owner is disposed', () => {
  createRoot((dispose) => {
    const pending = createPendingProjectTasks({ retentionMs: 1_000 });
    pending.begin('project', task('temp')).confirm('task');
    expect(vi.getTimerCount()).toBe(1);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("logs a task's release and expiry in the trace of its create", async () => {
  const dispose = createRoot((dispose) => {
    const pending = createPendingProjectTasks({ retentionMs: 1_000 });
    pending
      .begin('project', task('temp-1'), trace('create-1'))
      .confirm('task-1');
    pending
      .begin('project', task('temp-2'), trace('create-2'))
      .confirm('task-2');
    pending.release(['task-1']);
    return dispose;
  });

  await vi.advanceTimersByTimeAsync(1_000);
  expect(logs.entries).toEqual([
    'create-1:project.tasks.pending_released',
    'create-2:project.tasks.pending_expired',
  ]);
  dispose();
});
