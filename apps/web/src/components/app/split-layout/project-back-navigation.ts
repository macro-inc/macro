import { parseProjectRoute } from '@app/features/projects/core/route';
import { isRecord } from '@app/lib/split-router';
import { paneRoute } from '@app/routes/app-route';
import type { SplitContent, SplitHandle } from './layoutManager';

/** Project routes share the Tasks split identity; inspect the route, not its id. */
export function projectLocation(content: SplitContent | null) {
  if (content?.type === 'component') {
    const legacy = parseProjectRoute(content.id);
    if (legacy)
      return {
        kind: 'detail' as const,
        projectId: legacy.id,
        section: legacy.section,
      };
  }
  const metadata = content?.entryMetadata;
  if (!isRecord(metadata) || !isRecord(metadata.route)) return;
  const matches = metadata.route.matches;
  if (!Array.isArray(matches)) return;
  const leaf: unknown = matches.at(-1);
  if (!isRecord(leaf)) return;
  if (leaf.id === 'tasks-projects') return { kind: 'list' as const };
  const task = leaf.id === 'tasks-project-task';
  if (
    task &&
    (!isRecord(leaf.params) ||
      typeof leaf.params.taskId !== 'string' ||
      !leaf.params.taskId)
  )
    return;
  const project = task ? matches.at(-2) : leaf;
  if (
    !isRecord(project) ||
    project.id !== 'tasks-project' ||
    !isRecord(project.params)
  )
    return;
  const { projectId, section } = project.params;
  if (typeof projectId !== 'string' || !projectId) return;
  if (section !== 'overview' && section !== 'tasks') return;
  if (task) return { kind: 'task' as const, projectId, section };
  return { kind: 'detail' as const, projectId, section };
}

/** Nested tasks return to their project; direct project links return to the list. */
export function projectBackFallback(
  content: SplitContent
): SplitContent | undefined {
  const location = projectLocation(content);
  if (!location || location.kind === 'list') return;
  const parent = { id: 'view-tasks', params: {} };
  const route =
    location.kind === 'task'
      ? paneRoute(parent, {
          id: 'tasks-project',
          params: { projectId: location.projectId, section: location.section },
        })
      : paneRoute(parent, {
          id: 'tasks-projects',
          params: { projectsTab: 'projects' },
        });
  return {
    type: 'component',
    id: 'tasks',
    entryMetadata: {
      route,
      ...(isRecord(content.entryMetadata) && {
        search: content.entryMetadata.search,
      }),
    },
  };
}

/** Former section entries are the same phone page, not a Back destination. */
export function runProjectBack(
  handle: Pick<SplitHandle, 'content' | 'goBackTo' | 'replace'>
) {
  const current = projectLocation(handle.content());
  if (!current || current.kind === 'list') return;
  const navigated = handle.goBackTo((content) => {
    const previous = projectLocation(content);
    // Closing a nested task returns to its project, not another task or pane.
    if (current.kind === 'task')
      return (
        previous?.kind === 'detail' && previous.projectId === current.projectId
      );
    // Closing a project skips both former sections and tasks already closed there.
    return (
      !previous ||
      previous.kind === 'list' ||
      previous.projectId !== current.projectId
    );
  });
  if (navigated) return;
  const next = projectBackFallback(handle.content());
  if (next) handle.replace({ next, mergeHistory: true });
}
