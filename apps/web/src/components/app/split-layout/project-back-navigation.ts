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
  if (leaf.id !== 'tasks-project' || !isRecord(leaf.params)) return;
  const { projectId, section } = leaf.params;
  if (typeof projectId !== 'string' || !projectId) return;
  if (section !== 'overview' && section !== 'tasks') return;
  return { kind: 'detail' as const, projectId, section };
}

/** A phone project is one page; direct links return to the Projects list. */
export function projectBackFallback(
  content: SplitContent
): SplitContent | undefined {
  const location = projectLocation(content);
  if (location?.kind !== 'detail') return;
  const parent = { id: 'view-tasks', params: {} };
  const route = paneRoute(parent, {
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
  if (current?.kind !== 'detail') return;
  const navigated = handle.goBackTo((content) => {
    const previous = projectLocation(content);
    return (
      previous?.kind !== 'detail' || previous.projectId !== current.projectId
    );
  });
  if (navigated) return;
  const next = projectBackFallback(handle.content());
  if (next) handle.replace({ next, mergeHistory: true });
}
