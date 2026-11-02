import { match } from 'ts-pattern';
import type { Review, ReviewItem } from './review';

/** What a workspace import does with one Notion object. */
export type ImportPlanDecision = 'copy' | 'tasks' | 'skip' | 'hand';

/** Which Notion columns become a task list's task fields. */
export type ImportTaskFields = {
  status: string | null;
  priority: string | null;
  due: string | null;
  assignee: string | null;
};

/** One Notion object in an import plan. */
export type ImportPlanEntry = {
  id: string;
  parentId: string | null;
  kind: 'page' | 'database' | 'task' | 'project';
  title: string;
  /** `null` while planning has not decided it yet. */
  decision: ImportPlanDecision | null;
  reason: string | null;
  rows: number | null;
  /** A few of a database's row titles. */
  sampleTitles: string[];
  /** For a task list: the columns its task fields come from. */
  taskFields: ImportTaskFields | null;
  status: 'staged' | 'importing' | 'imported' | 'discarded';
  error: string | null;
  /** The plan shares the written object with the owner's team. */
  shared: boolean;
  /** Why it is shared or kept private. */
  sharedReason: string | null;
  /** The owner may change `shared`. */
  shareable: boolean;
  /** A teammate's copy, already shared with the team, that this row links to. */
  alreadyImported: ImportedCopy | null;
};

/** A teammate's import of the same Notion object. */
export type ImportedCopy = {
  /** The teammate's email. */
  by: string;
  entityId: string;
  /** A Macro entity type, e.g. `md`, `project`, or `database`. */
  entityType: string;
};

/** A plan entry placed in its tree, in depth-first order. */
export type ImportPlanNode = ImportPlanEntry & {
  depth: number;
  childIds: string[];
};

export type ImportPlanCounts = {
  pages: number;
  databases: number;
  copy: number;
  tasks: number;
  skip: number;
  hand: number;
  /** Not decided yet. */
  deciding: number;
};

export type ImportReportItem = { id: string; title: string; reason: string };

/** Where the import run stands, as the server reports it. */
export type ImportProgress = {
  warnings?: string[];
  reviewId: string | null;
  status:
    | 'running'
    | 'ready'
    | 'importing'
    | 'completed'
    | 'failed'
    | 'dismissed'
    | null;
  error: string | null;
  /** What planning has found in Notion so far, while it reads it. */
  scanned: { pages: number; databases: number } | null;
  /** Without a team, everything stays with the owner. */
  onTeam: boolean;
  counts: ImportPlanCounts;
  imported: number;
  waiting: number;
  writing: number;
  failures: ImportReportItem[];
};

export type ImportReviewPhase =
  | { kind: 'preparing' }
  | { kind: 'planning' }
  | { kind: 'plan' }
  | { kind: 'starting' }
  | { kind: 'importing' }
  | { kind: 'completed' }
  | { kind: 'stopped' }
  | { kind: 'failed'; error: string }
  | { kind: 'dismissed' }
  | { kind: 'unknown'; error: string | null };

/**
 * The saved draft of an import review. `shared` and `personal` hold the rows
 * the owner switched to or from team sharing, against the plan's choice.
 */
export type ImportDraft = {
  source: 'notion' | 'linear' | 'jira';
  excluded: string[];
  shared: string[];
  personal: string[];
};

export const EMPTY_IMPORT_DRAFT: ImportDraft = {
  source: 'notion',
  excluded: [],
  shared: [],
  personal: [],
};

/** Whether a decision writes anything, and so can be left out. */
export function isWritten(decision: ImportPlanDecision | null): boolean {
  return match(decision)
    .with('copy', 'tasks', () => true)
    .with('skip', 'hand', null, () => false)
    .exhaustive();
}

/** Whether an entry becomes a new Macro object when the plan is approved. */
function isNew(entry: ImportPlanEntry): boolean {
  return isWritten(entry.decision) && entry.alreadyImported === null;
}

/**
 * The entries the plan tree shows: everything not already in Macro. A child
 * of an already-imported entry moves up to its nearest ancestor still shown.
 */
export function planTreeEntries(entries: ImportPlanEntry[]): ImportPlanEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const shownParent = (parentId: string | null): string | null => {
    const seen = new Set<string>();
    let current = parentId;
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const parent = byId.get(current);
      if (!parent || parent.alreadyImported === null) return current;
      current = parent.parentId;
    }
    return null;
  };
  return entries
    .filter((entry) => entry.alreadyImported === null)
    .map((entry) => ({ ...entry, parentId: shownParent(entry.parentId) }));
}

/** Entries a teammate already imported and shared with the team. */
export function alreadyInMacro(
  entries: ImportPlanEntry[]
): (ImportPlanEntry & { alreadyImported: ImportedCopy })[] {
  return entries.flatMap((entry) =>
    entry.alreadyImported
      ? [{ ...entry, alreadyImported: entry.alreadyImported }]
      : []
  );
}

/**
 * Orders entries depth-first under their parents. An entry whose parent is
 * not in the plan is a root; a cycle is broken where it is first revisited.
 */
export function buildPlanTree(entries: ImportPlanEntry[]): ImportPlanNode[] {
  const ids = new Set(entries.map((entry) => entry.id));
  const children = new Map<string, ImportPlanEntry[]>();
  const roots: ImportPlanEntry[] = [];
  for (const entry of entries) {
    if (
      entry.parentId &&
      entry.parentId !== entry.id &&
      ids.has(entry.parentId)
    ) {
      const siblings = children.get(entry.parentId) ?? [];
      siblings.push(entry);
      children.set(entry.parentId, siblings);
    } else {
      roots.push(entry);
    }
  }
  const placed = new Set<string>();
  const nodes: ImportPlanNode[] = [];
  const place = (entry: ImportPlanEntry, depth: number) => {
    if (placed.has(entry.id)) return;
    placed.add(entry.id);
    const below = (children.get(entry.id) ?? []).filter(
      (child) => !placed.has(child.id)
    );
    nodes.push({ ...entry, depth, childIds: below.map((child) => child.id) });
    for (const child of below) place(child, depth + 1);
  };
  for (const root of roots) place(root, 0);
  // Entries only reachable through a cycle become roots.
  for (const entry of entries) place(entry, 0);
  return nodes;
}

/** The nodes left showing when the given nodes are collapsed. */
export function visiblePlanNodes(
  nodes: ImportPlanNode[],
  collapsed: ReadonlySet<string>
): ImportPlanNode[] {
  const visible: ImportPlanNode[] = [];
  let hiddenBelow: number | null = null;
  for (const node of nodes) {
    if (hiddenBelow !== null && node.depth > hiddenBelow) continue;
    hiddenBelow = null;
    visible.push(node);
    if (collapsed.has(node.id) && node.childIds.length > 0)
      hiddenBelow = node.depth;
  }
  return visible;
}

/** Nodes with children below the top level start collapsed. */
export function initiallyCollapsed(nodes: ImportPlanNode[]): Set<string> {
  return new Set(
    nodes
      .filter((node) => node.depth > 0 && node.childIds.length > 0)
      .map((node) => node.id)
  );
}

/** The node and everything below it. */
function subtree(nodes: ImportPlanNode[], id: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const out: string[] = [];
  const visit = (current: string) => {
    const node = byId.get(current);
    if (!node || out.includes(current)) return;
    out.push(current);
    for (const child of node.childIds) visit(child);
  };
  visit(id);
  return out;
}

/**
 * Leaves an object (and the written objects below it) out of the import, or
 * brings them back. Objects that are never written are not recorded.
 */
export function setExcluded(
  draft: ImportDraft,
  nodes: ImportPlanNode[],
  id: string,
  excluded: boolean
): ImportDraft {
  const written = new Set(
    nodes.filter((node) => isWritten(node.decision)).map((node) => node.id)
  );
  const affected = subtree(nodes, id).filter((entry) => written.has(entry));
  const next = draft.excluded.filter((entry) => !affected.includes(entry));
  return {
    ...draft,
    excluded: excluded ? [...next, ...affected] : next,
  };
}

/** Whether the object is shared with the team when it is written. */
export function isShared(entry: ImportPlanEntry, draft: ImportDraft): boolean {
  if (!entry.shareable) return entry.shared;
  if (draft.shared.includes(entry.id)) return true;
  if (draft.personal.includes(entry.id)) return false;
  return entry.shared;
}

/**
 * Shares an object (and the shareable written objects below it) with the
 * team, or keeps them to the owner. Only choices that differ from the plan
 * are recorded.
 */
export function setShared(
  draft: ImportDraft,
  nodes: ImportPlanNode[],
  id: string,
  shared: boolean
): ImportDraft {
  const changeable = new Map(
    nodes
      .filter((node) => node.shareable && isNew(node))
      .map((node) => [node.id, node])
  );
  const affected = subtree(nodes, id).flatMap((entry) => {
    const node = changeable.get(entry);
    return node ? [node] : [];
  });
  const ids = new Set(affected.map((node) => node.id));
  const overrides = affected.filter((node) => node.shared !== shared);
  const added = overrides.map((node) => node.id);
  const sharedIds = draft.shared.filter((entry) => !ids.has(entry));
  const personalIds = draft.personal.filter((entry) => !ids.has(entry));
  return {
    ...draft,
    shared: shared ? [...sharedIds, ...added] : sharedIds,
    personal: shared ? personalIds : [...personalIds, ...added],
  };
}

/**
 * e.g. "12 shared with your team · 3 only you", over the objects approving
 * the plan writes; empty when it writes nothing. Without a team, says why
 * everything stays with the owner.
 */
export function sharingSummary(
  entries: ImportPlanEntry[],
  draft: ImportDraft,
  onTeam: boolean
): string {
  let team = 0;
  let personal = 0;
  for (const entry of entries) {
    if (!isNew(entry) || draft.excluded.includes(entry.id)) continue;
    if (isShared(entry, draft)) team += 1;
    else personal += 1;
  }
  if (!onTeam) {
    return personal > 0
      ? `${personal} only you — you're not on a team, so nothing is shared`
      : '';
  }
  return [
    team > 0 ? `${team} shared with your team` : '',
    personal > 0 ? `${personal} only you` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** e.g. "4 already in Macro (imported by ana@acme.com, bo@acme.com)". */
export function alreadyInMacroSummary(entries: ImportPlanEntry[]): string {
  const copies = alreadyInMacro(entries);
  if (copies.length === 0) return '';
  const by = [...new Set(copies.map((entry) => entry.alreadyImported.by))];
  return `${copies.length} already in Macro (imported by ${by.join(', ')})`;
}

/** Objects the import will write once approved. */
export function importCount(
  entries: ImportPlanEntry[],
  excluded: readonly string[]
): number {
  return entries.filter((entry) => isNew(entry) && !excluded.includes(entry.id))
    .length;
}

/** What approving the plan writes, in real numbers: every row is counted. */
export type ImportVolume = {
  projects: number;
  documents: number;
  databases: number;
  rows: number;
  taskLists: number;
  tasks: number;
};

/** The volume the plan writes, leaving out `excluded` entries. */
export function importVolume(
  entries: ImportPlanEntry[],
  excluded: readonly string[]
): ImportVolume {
  const volume: ImportVolume = {
    projects: 0,
    documents: 0,
    databases: 0,
    rows: 0,
    taskLists: 0,
    tasks: 0,
  };
  for (const entry of entries) {
    if (excluded.includes(entry.id) || entry.alreadyImported) continue;
    match(entry.decision)
      .with('copy', () => {
        if (entry.kind === 'database') {
          volume.databases += 1;
          volume.rows += entry.rows ?? 0;
        } else if (entry.kind === 'task') {
          volume.tasks += 1;
        } else if (entry.kind === 'project') {
          volume.projects += 1;
        } else {
          volume.documents += 1;
        }
      })
      .with('tasks', () => {
        volume.taskLists += 1;
        volume.tasks += entry.rows ?? 0;
      })
      .with('skip', 'hand', null, () => {})
      .exhaustive();
  }
  return volume;
}

/** One line of the plan's totals, e.g. "Databases 18 (405 rows)". */
export type ImportTotal = { label: string; value: string };

/** What the plan holds per kind, leaving out empty kinds. */
export function planTotals(
  entries: ImportPlanEntry[],
  excluded: readonly string[]
): ImportTotal[] {
  const volume = importVolume(entries, excluded);
  const skipped = entries.filter(
    (entry) => entry.decision === 'skip' && entry.alreadyImported === null
  ).length;
  const already = alreadyInMacro(entries).length;
  return [
    volume.projects > 0
      ? { label: 'Projects', value: `${volume.projects}` }
      : null,
    volume.tasks > 0 && volume.taskLists === 0
      ? { label: 'Tasks', value: `${volume.tasks}` }
      : null,
    volume.documents > 0
      ? { label: 'Documents', value: `${volume.documents}` }
      : null,
    volume.databases > 0
      ? {
          label: 'Databases',
          value: `${volume.databases} (${plural(volume.rows, 'row', 'rows')})`,
        }
      : null,
    volume.taskLists > 0
      ? {
          label: 'Task lists',
          value: `${volume.taskLists} (${plural(volume.tasks, 'task', 'tasks')})`,
        }
      : null,
    skipped > 0 ? { label: 'Skipped', value: `${skipped}` } : null,
    already > 0 ? { label: 'Already in Macro', value: `${already}` } : null,
  ].filter((total): total is ImportTotal => total !== null);
}

/**
 * What planning is doing: reading Notion until the plan is staged, then
 * deciding each object, e.g. "Deciding what to import: 40 of 84 decided".
 */
export function planningStatus(
  progress: ImportProgress | undefined,
  entries: ImportPlanEntry[],
  source: ImportDraft['source'] = 'notion'
): string {
  if (entries.length === 0) {
    const scanned = progress?.scanned;
    return scanned
      ? `Reading ${sourceLabel(source)}: ${plural(scanned.pages, source === 'notion' ? 'page' : 'issue', source === 'notion' ? 'pages' : 'issues')}, ${plural(scanned.databases, source === 'notion' ? 'database' : 'project', source === 'notion' ? 'databases' : 'projects')}`
      : `Reading ${sourceLabel(source)}…`;
  }
  const decided = entries.filter((entry) => entry.decision !== null).length;
  return `Deciding what to import: ${decided} of ${entries.length} decided`;
}

/** e.g. "54 pages, 18 databases (405 rows), 33 tasks". */
export function volumeLabel(volume: ImportVolume): string {
  const parts = [
    volume.documents > 0 ? plural(volume.documents, 'page', 'pages') : '',
    volume.databases > 0
      ? `${plural(volume.databases, 'database', 'databases')} (${plural(volume.rows, 'row', 'rows')})`
      : '',
    volume.tasks > 0 ? plural(volume.tasks, 'task', 'tasks') : '',
    volume.projects > 0 ? plural(volume.projects, 'project', 'projects') : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'nothing';
}

export function planCounts(entries: ImportPlanEntry[]): ImportPlanCounts {
  const counts: ImportPlanCounts = {
    pages: 0,
    databases: 0,
    copy: 0,
    tasks: 0,
    skip: 0,
    hand: 0,
    deciding: 0,
  };
  for (const entry of entries) {
    if (entry.kind === 'database' || entry.kind === 'project')
      counts.databases += 1;
    else counts.pages += 1;
    counts[entry.decision ?? 'deciding'] += 1;
  }
  return counts;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * e.g. "Notion shared 56 pages and 24 databases — importing 54 pages,
 * 18 databases (405 rows), 33 tasks · 6 skipped, 1 needs you".
 */
export function planSummary(
  counts: ImportPlanCounts,
  volume: ImportVolume,
  source: ImportDraft['source'] = 'notion'
): string {
  const shared = [
    counts.pages > 0
      ? plural(
          counts.pages,
          source === 'notion' ? 'page' : 'issue',
          source === 'notion' ? 'pages' : 'issues'
        )
      : '',
    counts.databases > 0
      ? plural(
          counts.databases,
          source === 'notion' ? 'database' : 'project',
          source === 'notion' ? 'databases' : 'projects'
        )
      : '',
  ]
    .filter(Boolean)
    .join(' and ');
  const left = [
    counts.skip > 0 ? `${counts.skip} skipped` : '',
    counts.hand > 0
      ? `${counts.hand} ${counts.hand === 1 ? 'needs' : 'need'} you`
      : '',
  ]
    .filter(Boolean)
    .join(', ');
  return [
    shared ? `${sourceLabel(source)} shared ${shared}` : '',
    `importing ${volumeLabel(volume)}`,
  ]
    .filter(Boolean)
    .join(' — ')
    .concat(left ? ` · ${left}` : '');
}

/** Progress counted from the plan rows, when the run reports another review. */
export function progressFromEntries(
  reviewId: string,
  entries: ImportPlanEntry[]
): ImportProgress {
  const pending = entries.filter(
    (entry) => entry.status === 'staged' && isWritten(entry.decision)
  );
  return {
    reviewId,
    status: null,
    error: null,
    scanned: null,
    onTeam: true,
    counts: planCounts(entries),
    imported: entries.filter((entry) => entry.status === 'imported').length,
    waiting: pending.length,
    writing: entries.filter((entry) => entry.status === 'importing').length,
    failures: pending
      .filter((entry) => entry.error)
      .map((entry) => ({
        id: entry.id,
        title: entry.title,
        reason: entry.error ?? '',
      })),
  };
}

/**
 * The review item decides whether the plan was approved; once it was, the
 * run's status says how the write is going.
 */
export function importReviewPhase(
  review: Pick<Review, 'presentedAt'>,
  item: Pick<ReviewItem, 'status' | 'error'> | undefined,
  progress: ImportProgress | undefined
): ImportReviewPhase {
  if (review.presentedAt == null || !item) return { kind: 'preparing' };
  return match(item.status)
    .returnType<ImportReviewPhase>()
    .with('pending', () =>
      progress?.status === 'running' ? { kind: 'planning' } : { kind: 'plan' }
    )
    .with('submitting', () => ({ kind: 'starting' }))
    .with('dismissed', () => ({ kind: 'dismissed' }))
    .with('unknown', () => ({ kind: 'unknown', error: item.error ?? null }))
    .with('completed', () =>
      match(progress?.status ?? null)
        .returnType<ImportReviewPhase>()
        .with('completed', () => ({ kind: 'completed' }))
        .with('dismissed', () => ({ kind: 'stopped' }))
        .with('failed', () => ({
          kind: 'failed',
          error: progress?.error ?? 'The import failed.',
        }))
        .with('importing', 'running', 'ready', () => ({ kind: 'importing' }))
        // Progress without a run status was counted from the rows because a
        // newer run replaced this one, so this run has finished.
        .with(null, () =>
          progress ? { kind: 'completed' } : { kind: 'importing' }
        )
        .exhaustive()
    )
    .exhaustive();
}

/** Human label for the source in a saved review draft. */
export function sourceLabel(source: ImportDraft['source']): string {
  return match(source)
    .with('notion', () => 'Notion')
    .with('linear', () => 'Linear')
    .with('jira', () => 'Jira')
    .exhaustive();
}
