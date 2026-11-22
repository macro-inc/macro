import type { OptimisticTask } from '@app/features/tasks-view/core/optimistic-task';
import { debounce } from '@core/util/debounce';
import { fireAndForget } from '@core/util/fireAndForget';
import type { TaskEntityWithProperties } from '@entity';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import { getOwner, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';

/**
 * How long a created task's stand-in waits for the project's list to show
 * it. The list's own subscription normally does so within a second; this
 * only bounds a task the list never shows (its project property was
 * rejected, a filter hides it, or the project read missed its push).
 */
export const PENDING_PROJECT_TASK_RETENTION_MS = 60_000;

type PendingProjectTask = OptimisticTask & {
  key: string;
  projectId: string;
  confirmedAt?: number;
  /** The create's trace, so its release or expiry joins it. */
  trace?: TraceContext;
};

/** One task being created, from submit to the server's answer. */
export type PendingProjectTaskHandle = {
  /** The server created it: show it under its real id until listed. */
  confirm(taskId: string): void;
  /** The create failed, or the task is not in the project: remove it. */
  fail(): void;
};

type PendingProjectTasksOptions = {
  retentionMs?: number;
  /**
   * Reads the project again before an unlisted task's stand-in goes, in case
   * its read missed the push that lists the task: without it, a project's
   * first task would hide behind the empty state.
   */
  beforeExpire?: (projectId: string) => Promise<void>;
};

/**
 * Tasks created in a project that its task list has not listed yet. Each
 * shows at once on submit, takes its real id when the create succeeds, and
 * goes when the create fails, when the list shows it, or at the retention
 * bound.
 */
export function createPendingProjectTasks({
  retentionMs = PENDING_PROJECT_TASK_RETENTION_MS,
  beforeExpire,
}: PendingProjectTasksOptions = {}) {
  const [state, setState] = createStore<{ tasks: PendingProjectTask[] }>({
    tasks: [],
  });
  // Each confirmed task's pending expiry, by key, as its cancel function.
  const expiries = new Map<string, () => void>();

  const remove = (keys: ReadonlySet<string>) => {
    for (const key of keys) {
      expiries.get(key)?.();
      expiries.delete(key);
    }
    setState('tasks', (tasks) => tasks.filter((task) => !keys.has(task.key)));
  };

  let disposed = false;
  if (getOwner()) {
    onCleanup(() => {
      disposed = true;
      for (const cancel of expiries.values()) cancel();
      expiries.clear();
    });
  }

  const expireTask = async (task: PendingProjectTask) => {
    // The list never showed it: a filter hides it, or the project read
    // missed its push.
    try {
      await inTrace(task, () => {
        Telemetry.warn('project.tasks.pending_expired', {
          'project.id': task.projectId,
          'document.id': task.entity.id,
        });
        return beforeExpire?.(task.projectId);
      });
    } finally {
      remove(new Set([task.key]));
    }
  };

  // A create that settles after the owner is gone, or whose task the list
  // already released, leaves no timer behind.
  const expireLater = (key: string) => {
    const task = state.tasks.find((candidate) => candidate.key === key);
    if (disposed || !task) return;
    const expire = debounce(() => {
      expiries.delete(key);
      fireAndForget(expireTask(task), 'project-pending-tasks');
    }, retentionMs);
    expiries.set(key, expire.clear);
    expire();
  };

  return {
    tasks(projectId: string): OptimisticTask[] {
      return state.tasks.filter((task) => task.projectId === projectId);
    },
    begin(
      projectId: string,
      entity: TaskEntityWithProperties,
      trace?: TraceContext
    ): PendingProjectTaskHandle {
      const key = entity.id;
      setState('tasks', (tasks) => [
        ...tasks,
        { key, projectId, entity, pending: true, trace },
      ]);
      let settled = false;
      return {
        confirm(taskId) {
          if (settled) return;
          settled = true;
          setState(
            'tasks',
            (task) => task.key === key,
            produce((task) => {
              task.entity = { ...task.entity, id: taskId };
              task.pending = false;
              task.confirmedAt = performance.now();
            })
          );
          expireLater(key);
        },
        fail() {
          settled = true;
          remove(new Set([key]));
        },
      };
    },
    /** The list shows these tasks itself now. */
    release(taskIds: readonly string[]) {
      const listed = new Set(taskIds);
      const released = state.tasks.filter(
        (task) => !task.pending && listed.has(task.entity.id)
      );
      if (released.length === 0) return;
      const now = performance.now();
      for (const task of released) {
        // How long the list took to show a created task itself.
        inTrace(task, () =>
          Telemetry.info('project.tasks.pending_released', {
            'project.id': task.projectId,
            'document.id': task.entity.id,
            'pending.listed_after_ms': Math.round(
              now - (task.confirmedAt ?? now)
            ),
          })
        );
      }
      remove(new Set(released.map((task) => task.key)));
    },
  };
}

/** Runs `operation` in the create's trace when there is one. */
function inTrace<T>(task: PendingProjectTask, operation: () => T): T {
  return task.trace ? task.trace.run(operation) : operation();
}
