import type { OptimisticTask } from '@app/features/tasks-view/core/optimistic-task';
import type { TaskEntityWithProperties } from '@entity';
import { getOwner, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';

/**
 * How long a created task's stand-in waits for the project's list to show
 * it. The list's own subscription normally does so within a second; this
 * only bounds a task the list never shows (its project property was
 * rejected, or a filter hides it).
 */
export const PENDING_PROJECT_TASK_RETENTION_MS = 60_000;

type PendingProjectTask = OptimisticTask & {
  key: string;
  projectId: string;
};

/** One task being created, from submit to the server's answer. */
export type PendingProjectTaskHandle = {
  /** The server created it: show it under its real id until listed. */
  confirm(taskId: string): void;
  /** The create failed, or the task is not in the project: remove it. */
  fail(): void;
};

/**
 * Tasks created in a project that its task list has not listed yet. Each
 * shows at once on submit, takes its real id when the create succeeds, and
 * goes when the create fails, when the list shows it, or at the retention
 * bound.
 */
export function createPendingProjectTasks(
  retentionMs = PENDING_PROJECT_TASK_RETENTION_MS
) {
  const [state, setState] = createStore<{ tasks: PendingProjectTask[] }>({
    tasks: [],
  });
  const expiries = new Map<string, ReturnType<typeof setTimeout>>();

  const remove = (keys: ReadonlySet<string>) => {
    for (const key of keys) {
      clearTimeout(expiries.get(key));
      expiries.delete(key);
    }
    setState('tasks', (tasks) => tasks.filter((task) => !keys.has(task.key)));
  };

  if (getOwner()) {
    onCleanup(() => {
      for (const expiry of expiries.values()) clearTimeout(expiry);
      expiries.clear();
    });
  }

  return {
    tasks(projectId: string): OptimisticTask[] {
      return state.tasks.filter((task) => task.projectId === projectId);
    },
    begin(
      projectId: string,
      entity: TaskEntityWithProperties
    ): PendingProjectTaskHandle {
      const key = entity.id;
      setState('tasks', (tasks) => [
        ...tasks,
        { key, projectId, entity, pending: true },
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
            })
          );
          expiries.set(
            key,
            setTimeout(() => remove(new Set([key])), retentionMs)
          );
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
      remove(
        new Set(
          state.tasks.flatMap((task) =>
            !task.pending && listed.has(task.entity.id) ? [task.key] : []
          )
        )
      );
    },
  };
}
