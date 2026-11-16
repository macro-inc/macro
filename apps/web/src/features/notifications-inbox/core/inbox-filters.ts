import { match } from 'ts-pattern';
import type { InboxRowType } from './inbox-row';

/** Every row type this build knows. */
export const ALL_INBOX_ROW_TYPES: readonly InboxRowType[] = [
  'agent',
  'email',
  'channel_mention',
  'channel_messages',
  'channel_thread',
  'discussion_mention',
  'discussion_messages',
  'discussion_thread',
  'task',
  'pull_request',
  'calendar_event',
  'calendar_join_request',
  'access_requested',
  'access_granted',
  'access_removed',
];

/** The kinds of notification a reader filters by. */
export type InboxCategory =
  | 'agents'
  | 'mentions'
  | 'replies'
  | 'messages'
  | 'comments'
  | 'email'
  | 'tasks'
  | 'pull_requests'
  | 'calendar'
  | 'access';

/** Categories in menu order. */
export const INBOX_CATEGORIES: readonly InboxCategory[] = [
  'mentions',
  'replies',
  'messages',
  'comments',
  'email',
  'tasks',
  'pull_requests',
  'calendar',
  'access',
  'agents',
];

/** The category a row type is filtered under. */
export const rowCategory = (type: InboxRowType): InboxCategory =>
  match(type)
    .with('agent', () => 'agents' as const)
    .with('channel_mention', 'discussion_mention', () => 'mentions' as const)
    .with('channel_thread', 'discussion_thread', () => 'replies' as const)
    .with('channel_messages', () => 'messages' as const)
    .with('discussion_messages', () => 'comments' as const)
    .with('email', () => 'email' as const)
    .with('task', () => 'tasks' as const)
    .with('pull_request', () => 'pull_requests' as const)
    .with('calendar_event', 'calendar_join_request', () => 'calendar' as const)
    .with(
      'access_requested',
      'access_granted',
      'access_removed',
      () => 'access' as const
    )
    .exhaustive();

/** Which rows a reader wants: by read state, and the categories they hide. */
export type InboxStatus = 'all' | 'unread';

export type InboxFilters = {
  status: InboxStatus;
  /** Hidden rather than shown, so a category added later starts visible. */
  hiddenCategories: readonly InboxCategory[];
};

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  status: 'all',
  hiddenCategories: [],
};

/** The row types to read for these filters; [] when every category is hidden. */
export function rowTypesFor(filters: InboxFilters): InboxRowType[] {
  return ALL_INBOX_ROW_TYPES.filter(
    (type) => !filters.hiddenCategories.includes(rowCategory(type))
  );
}

/**
 * Which rows a clear takes: those of these types, only unread ones when
 * `unreadOnly`, and only those whose newest notification arrived at or after
 * `since` (epoch milliseconds) when it is set.
 */
export type InboxClear = {
  rowTypes: readonly InboxRowType[];
  unreadOnly: boolean;
  since?: number;
};

/** What a reader asked to clear: today, everything, or one kind. */
export type InboxClearChoice =
  | { kind: 'today' }
  | { kind: 'all' }
  | { kind: 'category'; category: InboxCategory };

/**
 * The clear a choice makes under the reader's filters: never a kind the
 * filters hide, only unread rows under Unread, and today from local
 * midnight, as the list's today sections are.
 */
export function clearFor(
  choice: InboxClearChoice,
  filters: InboxFilters,
  now: Date
): InboxClear {
  const shown = rowTypesFor(filters);
  const unreadOnly = filters.status === 'unread';
  return match(choice)
    .returnType<InboxClear>()
    .with({ kind: 'today' }, () => ({
      rowTypes: shown,
      unreadOnly,
      since: new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      ).getTime(),
    }))
    .with({ kind: 'all' }, () => ({ rowTypes: shown, unreadOnly }))
    .with({ kind: 'category' }, ({ category }) => ({
      rowTypes: shown.filter((type) => rowCategory(type) === category),
      unreadOnly,
    }))
    .exhaustive();
}

/** Whether a clear takes a row. */
export function clearIncludes(
  clear: InboxClear,
  row: { type: InboxRowType | 'other'; unseen: boolean; latestAt: number }
): boolean {
  return (
    row.type !== 'other' &&
    clear.rowTypes.includes(row.type) &&
    (!clear.unreadOnly || row.unseen) &&
    (clear.since === undefined || row.latestAt >= clear.since)
  );
}

/**
 * How many kinds of notification are hidden, for the filter trigger's badge.
 * The All and Unread toggle shows its own state.
 */
export function activeFilterCount(filters: InboxFilters): number {
  return filters.hiddenCategories.length;
}

const isStatus = (value: unknown): value is InboxStatus =>
  value === 'all' || value === 'unread';
const isCategory = (value: unknown): value is InboxCategory =>
  INBOX_CATEGORIES.some((category) => category === value);

/** Read saved filters, keeping only what this build understands. */
export function parseInboxFilters(raw: string | null): InboxFilters {
  if (!raw) return DEFAULT_INBOX_FILTERS;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_INBOX_FILTERS;
  }
  if (typeof value !== 'object' || value === null) return DEFAULT_INBOX_FILTERS;
  const status = 'status' in value ? value.status : undefined;
  const hidden = 'hiddenCategories' in value ? value.hiddenCategories : [];
  return {
    status: isStatus(status) ? status : 'all',
    hiddenCategories: Array.isArray(hidden) ? hidden.filter(isCategory) : [],
  };
}
