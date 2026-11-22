/**
 * Prompts whose send could not be confirmed, by session.
 *
 * They may have run, so their text is not put back in the box, and they must
 * not be lost either. Kept here, outside any one `AgentSession`, and in local
 * storage like the composer draft, so a reload, a session that leaves memory,
 * or one released mid-check still shows them. One leaves when its row reaches
 * the log, or when the person resends or dismisses it.
 */

import { createPersistenceKey } from '@queries/persistence';
import type { AgentAction } from '@service-agent-harness/generated/schemas';

export type UnconfirmedSend = { actionId: string; action: AgentAction };

export function unconfirmedSendsKey(sessionId: string) {
  return createPersistenceKey(`agent-session-unconfirmed:${sessionId}`, 0);
}

const held = new Map<string, UnconfirmedSend[]>();
const listeners = new Map<string, Set<() => void>>();

function isUnconfirmedSend(value: unknown): value is UnconfirmedSend {
  if (typeof value !== 'object' || value === null) return false;
  const { actionId, action } = value as Partial<UnconfirmedSend>;
  return (
    typeof actionId === 'string' &&
    typeof action === 'object' &&
    action !== null &&
    typeof action.type === 'string'
  );
}

function read(sessionId: string): UnconfirmedSend[] {
  const cached = held.get(sessionId);
  if (cached) return cached;
  let stored: UnconfirmedSend[] = [];
  try {
    const raw = localStorage.getItem(unconfirmedSendsKey(sessionId));
    const parsed: unknown = raw == null ? undefined : JSON.parse(raw);
    if (Array.isArray(parsed)) stored = parsed.filter(isUnconfirmedSend);
  } catch {
    // Unreadable storage holds nothing to show.
  }
  held.set(sessionId, stored);
  return stored;
}

function write(sessionId: string, sends: UnconfirmedSend[]) {
  held.set(sessionId, sends);
  try {
    const key = unconfirmedSendsKey(sessionId);
    if (sends.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(sends));
  } catch {
    // A full or blocked store still keeps them for this page.
  }
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

/** The session's unconfirmed prompts, oldest first. */
export function unconfirmedSends(
  sessionId: string
): readonly UnconfirmedSend[] {
  return read(sessionId);
}

/** Keep a prompt whose send could not be confirmed. */
export function holdUnconfirmedSend(sessionId: string, send: UnconfirmedSend) {
  const sends = read(sessionId).filter(
    (entry) => entry.actionId !== send.actionId
  );
  write(sessionId, [...sends, send]);
}

/** Let go of the ones whose action ids are given; true when any left. */
export function dropUnconfirmedSends(
  sessionId: string,
  actionIds: Iterable<string>
): boolean {
  const gone = new Set(actionIds);
  const sends = read(sessionId);
  const kept = sends.filter((entry) => !gone.has(entry.actionId));
  if (kept.length === sends.length) return false;
  write(sessionId, kept);
  return true;
}

/** Follow a session's unconfirmed prompts. */
export function subscribeUnconfirmedSends(
  sessionId: string,
  listener: () => void
): () => void {
  const set = listeners.get(sessionId) ?? new Set();
  set.add(listener);
  listeners.set(sessionId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(sessionId);
  };
}

/** Forget what this page holds in memory, for tests that simulate a reload. */
export function forgetUnconfirmedSendsInMemory() {
  held.clear();
}
