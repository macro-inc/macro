import { createMemo, createSignal } from 'solid-js';
import type { ProjectsContext } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';

type AssignTasks = ReturnType<ProjectsContext['createCommands']>['assignTasks'];

/**
 * Picks existing tasks to add to a project. A partial failure keeps only the
 * failed tasks selected, so trying again retries just those.
 */
export function createAddProjectTasks(options: {
  project: () => ProjectDetail;
  assignTasks: AssignTasks;
}) {
  const [selected, setSelected] = createSignal(new Set<string>());
  const [error, setError] = createSignal<string>();
  const [saving, setSaving] = createSignal(false);
  const excludedIds = createMemo(() => new Set(options.project().taskIds));

  const reset = () => {
    setSelected(new Set<string>());
    setError(undefined);
  };

  /** Resolves true once every picked task was added. */
  const add = async () => {
    const taskIds = [...selected()].filter((id) => !excludedIds().has(id));
    if (saving() || !taskIds.length) return false;
    setSaving(true);
    setError(undefined);
    try {
      const results = await options.assignTasks(options.project().id, taskIds);
      const failed = results.filter((result) => result.error);
      if (!failed.length) return true;
      setSelected(new Set(failed.map((result) => result.taskId)));
      setError(
        `${failed.length} ${failed.length === 1 ? 'task could' : 'tasks could'} not be added. ${failed[0].error}`
      );
      return false;
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Could not add tasks. Try again.'
      );
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    selected,
    select: (ids: Set<string>) => {
      if (!saving()) setSelected(ids);
    },
    error,
    saving,
    excludedIds,
    reset,
    add,
  };
}
