import { Telemetry } from '@macro-inc/observability';
import { createMemo, createSignal, onCleanup } from 'solid-js';
import type { ProjectsContext } from '../context/projects-context';
import { canEditProject, type ProjectDetail } from '../core/project';

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

/** Failed picks remain selected; stale project or picker completions are ignored. */
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
  let generation = 0;
  onCleanup(() => generation++);
  const current = () =>
    draft().projectId === projectId() ? draft() : undefined;
  const excludedIds = createMemo(() => new Set(options.project().taskIds));
  const selected = createMemo(
    () =>
      new Set(
        [...(current()?.selected ?? [])].filter((id) => !excludedIds().has(id))
      )
  );
  const error = () => current()?.error;
  const saving = () => savingFor() === projectId();

  const reset = () => {
    generation++;
    setSavingFor(undefined);
    setDraft({ projectId: projectId(), selected: new Set<string>() });
  };

  /** Resolves true only for a successful assignment in the current picker. */
  const add = async () => {
    const project = projectId();
    const picks = selected();
    const taskIds = [...picks];
    if (!canEditProject(options.project()) || saving() || !taskIds.length)
      return false;
    const request = generation;
    const isCurrent = () => request === generation && project === projectId();
    setSavingFor(project);
    setDraft({ projectId: project, selected: picks });
    try {
      const results = await Telemetry.span(
        'project.tasks.assign',
        async (span) => {
          span.setAttr('project.id', project);
          span.setAttr('task.count', taskIds.length);
          const results = await options.assignTasks(project, taskIds);
          const failed = results.filter((result) => result.error);
          span.setAttr('task.failed_count', failed.length);
          if (failed.length) span.error('Some tasks could not be added');
          return results;
        }
      );
      if (!isCurrent()) return false;
      const failed = results.filter((result) => result.error);
      if (!failed.length) return true;
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
      if (!isCurrent()) return false;
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
      if (request === generation)
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
