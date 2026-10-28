import type { BoardAuthor, BoardItem, BoardMessage } from '../core/item';

export const NOW = Date.UTC(2026, 9, 28, 17, 0);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export function author(
  name: string,
  overrides: Partial<BoardAuthor> = {}
): BoardAuthor {
  return {
    id: `macro|${name.toLowerCase()}@example.com`,
    kind: 'person',
    name,
    isSelf: false,
    ...overrides,
  };
}

export function message(
  text: string,
  overrides: Partial<BoardMessage> = {}
): BoardMessage {
  return {
    id: `${text}-${overrides.at ?? NOW}`,
    text,
    at: NOW,
    unread: false,
    ...overrides,
  };
}

/** A read channel item with one message, active `ageMs` before `NOW`. */
export function boardItem(
  key: string,
  overrides: Partial<BoardItem> = {}
): BoardItem {
  const lastActivityAt = overrides.lastActivityAt ?? NOW - HOUR;
  return {
    key,
    zone: 'channels',
    kind: 'channel',
    title: key,
    messages: [message(`hello from ${key}`, { at: lastActivityAt })],
    lastActivityAt,
    unreadCount: 0,
    needsYou: false,
    participants: [],
    ...overrides,
  };
}
