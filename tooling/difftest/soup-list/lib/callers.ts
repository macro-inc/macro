/**
 * The former callers of `useSoupItemsQuery` / `getSoupItems`, and for each one
 * the projection its UI renders or acts on (the caller-level contract): rows,
 * labels, order, counts, enabled state, menu items. Timestamps become epoch
 * milliseconds, since every caller parses them before use.
 */
import { ms } from './compare';

type Row = Record<string, any>;

const rows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);

/** Fields a list row shows: what it is, its label, and when (sort keys). */
function listRow(row: Row) {
  return {
    type: row.type,
    id: row.id,
    name: row.name,
    subType: row.subType?.type ?? null,
    viewedAt: ms(row.viewedAt),
    updatedAt: ms(row.updatedAt),
    createdAt: ms(row.createdAt),
  };
}

/** What a task row renders (TaskListEntity: name, status/priority/assignee pills, unread). */
function taskRow(row: Row) {
  return {
    ...listRow(row),
    ownerId: row.ownerId,
    projectId: row.projectId ?? null,
    completed: row.subType?.is_completed ?? null,
    properties: rows(row.properties).map((p) => ({
      id: p.id,
      definition: {
        id: p.definition?.id,
        display_name: p.definition?.display_name,
        data_type: p.definition?.data_type,
        is_multi_select: p.definition?.is_multi_select,
        specific_entity_type: p.definition?.specific_entity_type ?? null,
        is_system: p.definition?.is_system,
        is_metadata: p.definition?.is_metadata,
      },
      // converters.ts:36-46: a null and a missing value are both "no value".
      value: p.value ?? null,
    })),
    openNotifications: rows(row.notifications).filter((n) => n?.state !== 'done').length,
  };
}

/** The slash menu's PR item (SkillsMenu.tsx: label owner/repo#number, url, filter text). */
function prItem(row: Row) {
  const m = row.metadata ?? {};
  return {
    id: row.id,
    foreignId: row.foreignId,
    name: row.name ?? null,
    label: `${m.owner}/${m.repo}#${m.number}`,
    url: m.url || null,
    status: m.status ?? null,
    draft: m.draft ?? null,
  };
}

function quickAccessItem(item: Row) {
  const t = item.timestamps ?? {};
  return {
    kind: item.kind,
    bucket: item.bucket,
    id: item.id,
    name: item.name ?? null,
    searchText: item.searchText ?? null,
    sortTimestamp: item.sortTimestamp ?? null,
    viewedAt: ms(t.viewedAt),
    updatedAt: ms(t.updatedAt),
    createdAt: ms(t.createdAt),
  };
}

/** Converts every ISO timestamp in a value to epoch ms (for callers that only format them). */
export function parseTimes(value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return ms(value);
  if (Array.isArray(value)) return value.map(parseTimes);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, parseTimes(v)]));
  return value;
}

export type CallerSpec = {
  name: string;
  /** Who the caller is in the app (file on the PR head). */
  site: string;
  project: (caller: unknown) => unknown;
};

export const CALLERS: Record<string, CallerSpec> = {
  'qa.agentSessions': {
    name: 'Quick access: agent sessions',
    site: 'lib/queries/soup/quick-access-agent-sessions.ts',
    project: (c) => rows(c).map(listRow),
  },
  'qa.initiatives': {
    name: 'Quick access: initiatives',
    site: 'lib/queries/soup/quick-access-initiatives.ts',
    project: (c) => rows(c).map(listRow),
  },
  'qa.skills': {
    name: 'Quick access: skills',
    site: 'lib/queries/soup/quick-access-skills.ts',
    project: (c) => rows(c).map(listRow),
  },
  'qa.snippets': {
    name: 'Quick access: snippets',
    site: 'lib/queries/soup/quick-access-snippets.ts',
    project: (c) => rows(c).map(listRow),
  },
  'crm.suggestions': {
    name: 'CRM company suggestions',
    site: 'features/crm/crm-search.ts',
    project: (c) =>
      rows(c).map((r) => ({
        ...listRow(r),
        hidden: r.hidden,
        domains: rows(r.domains).map((d) => d.domain),
      })),
  },
  'slash.prs': {
    name: 'Slash menu: pull requests',
    site: 'lib/queries/soup/slash-menu-pull-requests.ts',
    project: (c) => rows(c).map(prItem),
  },
  'home.recentChats': {
    name: 'Home: recent sessions',
    site: 'features/home/home-recent-sessions.tsx',
    project: (c) =>
      rows(c).map((r) => ({ id: r.id, name: r.name, model: r.model, updatedAt: ms(r.updatedAt) })),
  },
  recentlyViewed: {
    name: 'Recently viewed (quick access viewedAt map)',
    site: 'lib/queries/soup/recently-viewed.ts',
    project: (c) => rows(c).map((r) => ({ type: r.type, id: r.id, viewedAt: ms(r.viewedAt) })),
  },
  'fig.libraries': {
    name: 'Fig libraries',
    site: 'features/block-fig/queries/fig-libraries.ts',
    project: (c) => parseTimes(c),
  },
  'email.recent': {
    name: 'Mentions: recent email',
    site: 'core/component/LexicalMarkdown/.../useEmailSearchMention.ts',
    project: (c) => parseTimes(c),
  },
  hover: {
    name: 'Document title hover card',
    site: 'features/entity-detail/DocumentTitleHoverCard.tsx',
    project: (c) => c,
  },
  taskDup: {
    name: 'Similar tasks list',
    site: 'features/block-md/component/TaskDuplicateList.tsx',
    project: (c) => rows(c).map(taskRow),
  },
  quickAccess: {
    name: 'Quick access list (every bucket the readers feed)',
    site: 'lib/core/context/quickAccess/QuickAccessSource.tsx',
    project: (c) => rows(c).map(quickAccessItem),
  },
};

/** CRM export: the rows the CSV writes. */
export function exportView(value: any) {
  return {
    progress: value?.progress?.length ? value.progress[value.progress.length - 1] : 0,
    companies: rows(value?.companies)
      .map((r) => ({
        id: r.id,
        name: r.name,
        hidden: r.hidden,
        domains: rows(r.domains).map((d) => d.domain),
        properties: rows(r.properties).map((p) => ({ id: p.definition?.id, value: p.value })),
        updatedAt: ms(r.updatedAt),
        createdAt: ms(r.createdAt),
      })),
  };
}
