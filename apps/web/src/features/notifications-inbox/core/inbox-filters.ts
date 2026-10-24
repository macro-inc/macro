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
    .with('access_requested', 'access_granted', () => 'access' as const)
    .exhaustive();

/** Which rows a reader wants: by read state, and the categories they hide. */
export type InboxStatus = 'all' | 'unread' | 'read';

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

/** Whether a row's read state passes the status filter. */
export function statusIncludes(status: InboxStatus, unseen: boolean): boolean {
  return match(status)
    .with('all', () => true)
    .with('unread', () => unseen)
    .with('read', () => !unseen)
    .exhaustive();
}

/** How many filters differ from the defaults, for the trigger's badge. */
export function activeFilterCount(filters: InboxFilters): number {
  return filters.hiddenCategories.length + (filters.status === 'all' ? 0 : 1);
}

const isStatus = (value: unknown): value is InboxStatus =>
  value === 'all' || value === 'unread' || value === 'read';
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
