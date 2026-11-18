import { createMemo, createSignal } from 'solid-js';
import type { ProjectsContext } from '../context/projects-context';
import type { ProjectDetail } from '../core/project';

type AssignTasks = ReturnType<ProjectsContext['createCommands']>['assignTasks'];

/** Why the last add failed; each view words it for its own surface. */
export type AddProjectTasksError =
  | { kind: 'partial'; count: number; reason: string }
  | { kind: 'request'; message?: string };

type Draft = {
  projectId: string;
  selected: Set<string>;
  error?: AddProjectTasksError;
};

/**
 * Picks existing tasks to add to a project. A partial failure keeps only the
 * failed tasks selected, so trying again retries just those. The picks, the
 * error and the pending add belong to the project they were made for, so a
 * late answer never reaches another project.
 */
export function createAddProjectTasks(options: {
  project: () => ProjectDetail;
  assignTasks: AssignTasks;
}) {
  const projectId = () => options.project().id;
  const [draft, setDraft] = createSignal<Draft>({
    projectId: projectId(),
    selected: new Set(),
  });
  const [savingFor, setSavingFor] = createSignal<string>();
  const current = () =>
    draft().projectId === projectId() ? draft() : undefined;
  const selected = createMemo(() => current()?.selected ?? new Set<string>());
  const error = () => current()?.error;
  const saving = () => savingFor() === projectId();
  const excludedIds = createMemo(() => new Set(options.project().taskIds));

  const reset = () =>
    setDraft({ projectId: projectId(), selected: new Set<string>() });

  /** Resolves true once every picked task was added. */
  const add = async () => {
    const project = projectId();
    const picks = selected();
    const taskIds = [...picks].filter((id) => !excludedIds().has(id));
    if (saving() || !taskIds.length) return false;
    setSavingFor(project);
    setDraft({ projectId: project, selected: picks });
    try {
      const results = await options.assignTasks(project, taskIds);
      const failed = results.filter((result) => result.error);
      if (!failed.length) return project === projectId();
      setDraft({
        projectId: project,
        selected: new Set(failed.map((result) => result.taskId)),
        error: {
          kind: 'partial',
          count: failed.length,
          reason: failed[0].error ?? '',
        },
      });
      return false;
    } catch (error) {
      setDraft({
        projectId: project,
        selected: picks,
        error: {
          kind: 'request',
          message: error instanceof Error ? error.message : undefined,
        },
      });
      return false;
    } finally {
      setSavingFor((pending) => (pending === project ? undefined : pending));
    }
  };

  return {
    selected,
    select: (ids: Set<string>) => {
      if (!saving())
        setDraft({ projectId: projectId(), selected: ids, error: error() });
    },
    error,
    saving,
    excludedIds,
    reset,
    add,
  };
}
