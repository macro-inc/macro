import { match } from 'ts-pattern';
import { detectPrOrigin, type PrOrigin } from './pr-origin';

export type PrPriorityId = 'urgent' | 'high' | 'medium' | 'low' | 'none';

/** Where a pull request's priority came from. */
export type PrPriority =
  | { id: 'none' }
  | {
      id: Exclude<PrPriorityId, 'none'>;
      source: 'task';
      /** The linked task whose Priority this is. */
      taskId: string;
    }
  | { id: Exclude<PrPriorityId, 'none'>; source: 'label' };

/** The entity whose thread an agent session was started from. */
export type PrLinkSessionParent = {
  type: 'channel' | 'document' | 'crm_company' | 'crm_contact' | 'other';
  id: string;
};

export type PrLinkSession = {
  id: string;
  /** `agent` when the session's agent opened the pull request. */
  source: 'agent' | 'user';
  parent?: PrLinkSessionParent;
  /** The session's harness slug, for sessions whose agent opened the PR. */
  harness?: string;
};

/** A task the pull request references: a customer ticket when it names a company. */
export type PrLinkTask = {
  id: string;
  name: string;
  priority: PrPriorityId;
  closed: boolean;
  /** CRM companies in the task's Companies property. */
  companyIds: string[];
};

export type GithubLabelLike = { name: string };

/** Everything one pull request row links to. */
export type PrLinks = {
  sessions: PrLinkSession[];
  /** Linked tasks, open first, most urgent first. */
  tasks: PrLinkTask[];
  channelIds: string[];
  companyIds: string[];
  priority: PrPriority;
  /** Where the pull request was started, when anything gives it away. */
  origin?: PrOrigin;
};

export type PrLinkKind = 'agent' | 'ticket' | 'customer' | 'channel';

/** Most to least urgent; `none` sorts last. */
export const PR_PRIORITY_IDS: readonly PrPriorityId[] = [
  'urgent',
  'high',
  'medium',
  'low',
  'none',
];

export const PR_PRIORITY_LABELS: Record<PrPriorityId, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
};

const PRIORITY_RANK: Record<PrPriorityId, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

/**
 * GitHub label names teams use for priority: `P0`–`P3`, `priority: high`,
 * `urgent`, `critical`. Anything else is not a priority label.
 */
export function priorityFromLabelName(
  name: string
): Exclude<PrPriorityId, 'none'> | null {
  const label = name.trim().toLowerCase();
  const level = label.match(/^(?:priority[\s:/_-]*)?p([0-3])$/)?.[1];
  if (level) return (['urgent', 'high', 'medium', 'low'] as const)[+level];
  if (label === 'urgent' || label === 'critical') return 'urgent';
  const named = label.match(
    /^priority[\s:/_-]*(urgent|critical|high|medium|low)$/
  )?.[1];
  if (!named) return null;
  return named === 'critical'
    ? 'urgent'
    : (named as Exclude<PrPriorityId, 'none'>);
}

const higher = (a: PrPriority, b: PrPriority) =>
  PRIORITY_RANK[b.id] > PRIORITY_RANK[a.id] ? b : a;

/**
 * A pull request's priority: the most urgent linked task's, else the most
 * urgent GitHub priority label's. Open tasks outrank closed ones, so a PR
 * stays labeled by the work it still unblocks.
 */
export function derivePriority(
  tasks: readonly PrLinkTask[],
  labels: readonly GithubLabelLike[]
): PrPriority {
  const open = tasks.filter((task) => !task.closed);
  const candidates = open.length > 0 ? open : tasks;
  let priority: PrPriority = { id: 'none' };
  for (const task of candidates)
    if (task.priority !== 'none')
      priority = higher(priority, {
        id: task.priority,
        source: 'task',
        taskId: task.id,
      });
  if (priority.id !== 'none') return priority;
  for (const label of labels) {
    const id = priorityFromLabelName(label.name);
    if (id) priority = higher(priority, { id, source: 'label' });
  }
  return priority;
}

export const comparePriority = (a: PrPriorityId, b: PrPriorityId) =>
  PRIORITY_RANK[b] - PRIORITY_RANK[a];

const unique = (values: Iterable<string>) => [...new Set(values)];

/**
 * Join a pull request's linked sessions and tasks into the links its row
 * shows. Channels and customers come from where each session was started and
 * from each task's Companies property.
 */
export function buildPrLinks(input: {
  sessions: readonly PrLinkSession[];
  tasks: readonly PrLinkTask[];
  labels: readonly GithubLabelLike[];
  description?: string;
  headBranch?: string;
  authorLogin?: string;
}): PrLinks {
  const tasks = [...input.tasks].sort(
    (a, b) =>
      Number(a.closed) - Number(b.closed) ||
      comparePriority(a.priority, b.priority)
  );
  return {
    sessions: [...input.sessions],
    tasks,
    channelIds: unique(
      input.sessions.flatMap((session) =>
        session.parent?.type === 'channel' ? [session.parent.id] : []
      )
    ),
    companyIds: unique([
      ...tasks.flatMap((task) => task.companyIds),
      ...input.sessions.flatMap((session) =>
        session.parent?.type === 'crm_company' ? [session.parent.id] : []
      ),
    ]),
    priority: derivePriority(tasks, input.labels),
    origin: detectPrOrigin(input),
  };
}

/** Whether any link of `kind` exists, for the Reviews link filter. */
export const hasPrLink = (links: PrLinks, kind: PrLinkKind) =>
  match(kind)
    .with('agent', () => links.sessions.length > 0)
    .with('ticket', () => links.tasks.length > 0)
    .with('customer', () => links.companyIds.length > 0)
    .with('channel', () => links.channelIds.length > 0)
    .exhaustive();

/** The name of the task a pull request's priority comes from, if any. */
export function priorityTaskName(links: PrLinks): string | undefined {
  const { priority } = links;
  if (priority.id === 'none' || priority.source !== 'task') return undefined;
  return links.tasks.find((task) => task.id === priority.taskId)?.name;
}
