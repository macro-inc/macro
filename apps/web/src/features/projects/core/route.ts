import type { ProjectSection } from './project';

const PREFIX = 'initiative-view~';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProjectRoute = {
  id: string;
  section: ProjectSection;
  discussionId?: string;
};

/** Both identity and section survive split URL restoration. */
export function projectRouteId(route: ProjectRoute): string {
  return `${PREFIX}${route.id}~${route.section}${route.discussionId ? `~${route.discussionId}` : ''}`;
}

export function parseProjectRoute(value: string): ProjectRoute | undefined {
  if (!value.startsWith(PREFIX)) return;
  const [id, rawSection = 'overview', discussionId, extra] = value
    .slice(PREFIX.length)
    .split('~');
  if (!id || !UUID.test(id) || extra !== undefined) return;
  // Existing activity links now land on the combined Overview.
  const section = rawSection === 'activity' ? 'overview' : rawSection;
  if (section !== 'overview' && section !== 'tasks') return;
  if (discussionId && (section !== 'overview' || !UUID.test(discussionId)))
    return;
  if (discussionId === '') return;
  return { id, section, ...(discussionId ? { discussionId } : {}) };
}
