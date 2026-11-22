import type { TaskEntityWithProperties } from '@entity';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createPendingProjectTasks } from './pending-project-tasks';

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
});
afterEach(() => {
  vi.useRealTimers();
});

it('settles creates in whatever order the server answers them', () => {
  createRoot((dispose) => {
    const pending = createPendingProjectTasks(1_000);
    const first = pending.begin('project', task('temp-1'));
    const second = pending.begin('project', task('temp-2'));
    pending.begin('other', task('temp-3'));
    expect(shown(pending)).toEqual(['temp-1…', 'temp-2…']);

    second.confirm('task-2');
    first.fail();
    expect(shown(pending)).toEqual(['task-2']);

    // A late answer for a settled create changes nothing.
    first.confirm('task-1');
    second.fail();
    expect(shown(pending)).toEqual(['task-2']);
    dispose();
  });
});

it('releases a confirmed task once listed, and only a confirmed one', () => {
  createRoot((dispose) => {
    const pending = createPendingProjectTasks(1_000);
    const created = pending.begin('project', task('temp-1'));
    pending.begin('project', task('temp-2'));
    created.confirm('task-1');

    pending.release(['task-1', 'temp-2']);
    expect(shown(pending)).toEqual(['temp-2…']);
    expect(vi.getTimerCount()).toBe(0);
    dispose();
  });
});

it('drops a confirmed task the list never shows at the retention bound', () => {
  createRoot((dispose) => {
    const pending = createPendingProjectTasks(1_000);
    pending.begin('project', task('temp')).confirm('task');
    vi.advanceTimersByTime(999);
    expect(shown(pending)).toEqual(['task']);
    vi.advanceTimersByTime(1);
    expect(shown(pending)).toEqual([]);
    dispose();
  });
});

it('clears its timers when its owner is disposed', () => {
  createRoot((dispose) => {
    const pending = createPendingProjectTasks(1_000);
    pending.begin('project', task('temp')).confirm('task');
    expect(vi.getTimerCount()).toBe(1);
    dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
