/**
 * The neighborhoods the board groups work into, in reading order. Every
 * layout places zones in this order, so Channels always leads.
 */
export const BOARD_ZONES = [
  'channels',
  'dms',
  'email',
  'docs',
  'agents',
  'calendar',
  'code',
] as const;

export type BoardZone = (typeof BOARD_ZONES)[number];

/** What kind of thing an item is, which decides its glyph. */
export type BoardItemKind =
  | 'channel'
  | 'dm'
  | 'thread'
  | 'email'
  | 'document'
  | 'task'
  | 'project'
  | 'agent'
  | 'chat'
  | 'event'
  | 'call'
  | 'pull-request'
  | 'other';

/**
 * Someone who said something. `id` is stable across items (a Macro user id,
 * an email address, or a bot id), so the People board can gather one
 * person's messages from every conversation.
 */
export type BoardAuthor = {
  id: string;
  kind: 'person' | 'contact' | 'agent';
  name: string;
  isSelf: boolean;
  avatarUrl?: string;
};

/** One speech bubble. Messages without an author are system events. */
export type BoardMessage = {
  id: string;
  author?: BoardAuthor;
  text: string;
  /** Epoch milliseconds. */
  at: number;
  unread: boolean;
};

/**
 * One conversation, thread, email, document or run on the board. Items carry
 * only what the board draws; the host keeps the entity behind `key` so it can
 * open it.
 */
export type BoardItem = {
  /** Stable across refreshes: `<entity type>:<id>`. */
  key: string;
  zone: BoardZone;
  kind: BoardItemKind;
  title: string;
  /** Where it happens when the title alone is ambiguous, e.g. a thread's channel. */
  context?: string;
  /** Items sharing a group sit together, e.g. a thread beside its channel. */
  groupKey?: string;
  /** Oldest first, at most `MAX_ITEM_MESSAGES`. */
  messages: BoardMessage[];
  /** Epoch milliseconds of the newest activity. */
  lastActivityAt: number;
  unreadCount: number;
  /** A mention, a direct message, a review request or a question for the viewer. */
  needsYou: boolean;
  /** Most recent first, without duplicates. */
  participants: BoardAuthor[];
  /** The face a direct message shows: the other person. */
  face?: BoardAuthor;
  /** A short state such as a pull request's or an agent run's. */
  status?: string;
};

/** Bubbles kept per item; older ones are already reflected in the unread count. */
export const MAX_ITEM_MESSAGES = 4;

export function zoneRank(zone: BoardZone): number {
  return BOARD_ZONES.indexOf(zone);
}

/** Unread and needs-you items first, then the most recent. */
export function compareByUrgency(a: BoardItem, b: BoardItem): number {
  const needs = Number(b.needsYou) - Number(a.needsYou);
  if (needs !== 0) return needs;
  const unread = Number(b.unreadCount > 0) - Number(a.unreadCount > 0);
  if (unread !== 0) return unread;
  return b.lastActivityAt - a.lastActivityAt;
}

/**
 * Orders items so related ones (a channel and its threads) stay adjacent,
 * with groups ranked by their most urgent member.
 */
export function orderWithGroups(items: readonly BoardItem[]): BoardItem[] {
  const sorted = [...items].sort(compareByUrgency);
  const groups = new Map<string, BoardItem[]>();
  for (const item of sorted) {
    const group = item.groupKey ?? item.key;
    const members = groups.get(group);
    if (members) members.push(item);
    else groups.set(group, [item]);
  }
  return [...groups.values()].flat();
}

/** The newest message, if any. */
export function latestMessage(item: BoardItem): BoardMessage | undefined {
  return item.messages.at(-1);
}

/**
 * How loud an item is, from 0 (quiet) to 1, for sizing nodes. Unread volume
 * and recency dominate; needs-you items always sit near the top.
 */
export function itemHeat(item: BoardItem, now: number): number {
  const hours = Math.max(0, now - item.lastActivityAt) / 3_600_000;
  const recency = 1 / (1 + hours / 3);
  const unread = Math.min(1, item.unreadCount / 6);
  const needs = item.needsYou ? 1 : 0;
  return Math.min(1, 0.45 * recency + 0.35 * unread + 0.3 * needs);
}
