/**
 * Prompts whose send could not be confirmed, by session and person.
 *
 * They may have run, so their text is not put back in the box, and they must
 * not be lost either. Kept here, outside any one `AgentSession`, and in local
 * storage like the composer draft, so a reload, a session that leaves memory,
 * or one released mid-check still shows them. One leaves when its row reaches
 * the log, or when the person resends or dismisses it.
 *
 * Each send has its own key, scoped to the person who sent it, so two tabs
 * never overwrite each other's and another account on this browser never
 * sees them; sign-out clears them all (`clearComposerStorage`). Old ones
 * expire, and a session keeps only its latest few.
 */

import { userScopedStorageKey } from '@core/util/userScopedStorage';
import type { AgentAction } from '@service-agent-harness/generated/schemas';

export type UnconfirmedSend = { actionId: string; action: AgentAction };

type Stored = UnconfirmedSend & { sessionId: string; heldAt: number };

/** Every key this store writes starts with this. */
export const UNCONFIRMED_SENDS_PREFIX = 'agent-session-unconfirmed:';

/** Long enough to come back to after a bad connection, not forever. */
const UNCONFIRMED_SEND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The most a session keeps; older ones go first. */
const MAX_SENDS_PER_SESSION = 10;
/** A prompt larger than this is kept for this page only. */
const MAX_STORED_CHARS = 100_000;

const sessionPrefix = (sessionId: string) =>
  `${UNCONFIRMED_SENDS_PREFIX}${sessionId}:`;

const keyOf = (sessionId: string, actionId: string, userId: string) =>
  userScopedStorageKey(`${sessionPrefix(sessionId)}${actionId}`, userId);

/** Sends this page holds without storage: too large, no user, or no storage. */
const inMemory = new Map<string, Stored>();
const listeners = new Map<string, Set<() => void>>();

function notify(sessionId: string) {
  for (const listener of listeners.get(sessionId) ?? []) listener();
}

function isStored(value: unknown): value is Stored {
  if (typeof value !== 'object' || value === null) return false;
  const { actionId, action, sessionId, heldAt } = value as Partial<Stored>;
  return (
    typeof actionId === 'string' &&
    typeof sessionId === 'string' &&
    typeof heldAt === 'number' &&
    typeof action === 'object' &&
    action !== null &&
    typeof action.type === 'string'
  );
}

/** Keys in storage for this session, for anyone. */
function storedKeys(sessionId: string): string[] {
  const keys: string[] = [];
  try {
    const prefix = sessionPrefix(sessionId);
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
  } catch {
    // Unreadable storage holds nothing.
  }
  return keys;
}

function readKey(key: string): Stored | undefined {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw == null ? undefined : JSON.parse(raw);
    return isStored(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function removeKey(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing more to do.
  }
}

/** The person's unconfirmed prompts in a session, oldest first. */
export function unconfirmedSends(
  sessionId: string,
  userId: string | undefined
): UnconfirmedSend[] {
  if (!userId) return [];
  const now = Date.now();
  const suffix = userScopedStorageKey('', userId);
  const found: Stored[] = [];
  for (const key of storedKeys(sessionId)) {
    if (!key.endsWith(suffix)) continue;
    const stored = readKey(key);
    if (!stored || now - stored.heldAt > UNCONFIRMED_SEND_TTL_MS)
      removeKey(key);
    else found.push(stored);
  }
  for (const [key, stored] of inMemory)
    if (key.startsWith(sessionPrefix(sessionId)) && key.endsWith(suffix))
      found.push(stored);
  return found
    .sort((left, right) => left.heldAt - right.heldAt)
    .map(({ actionId, action }) => ({ actionId, action }));
}

/** Keep a prompt whose send could not be confirmed, for the person who sent it. */
export function holdUnconfirmedSend(
  sessionId: string,
  userId: string | undefined,
  send: UnconfirmedSend
) {
  const stored: Stored = { ...send, sessionId, heldAt: Date.now() };
  const key = keyOf(sessionId, send.actionId, userId ?? '');
  const raw = JSON.stringify(stored);
  let persisted = false;
  if (userId && raw.length <= MAX_STORED_CHARS) {
    try {
      localStorage.setItem(key, raw);
      persisted = true;
    } catch {
      // Full or blocked: this page still keeps it.
    }
  }
  if (!persisted) inMemory.set(key, stored);
  if (userId) {
    const all = unconfirmedSends(sessionId, userId);
    for (const old of all.slice(
      0,
      Math.max(0, all.length - MAX_SENDS_PER_SESSION)
    ))
      dropUnconfirmedSends(sessionId, [old.actionId], { quiet: true });
  }
  notify(sessionId);
}

/** Let go of the ones whose action ids are given, whoever held them. */
export function dropUnconfirmedSends(
  sessionId: string,
  actionIds: Iterable<string>,
  options: { quiet?: boolean } = {}
): boolean {
  const gone = [...actionIds].map((id) => `${sessionPrefix(sessionId)}${id}:`);
  if (gone.length === 0) return false;
  let changed = false;
  for (const key of storedKeys(sessionId))
    if (gone.some((prefix) => key.startsWith(prefix))) {
      removeKey(key);
      changed = true;
    }
  for (const key of [...inMemory.keys()])
    if (gone.some((prefix) => key.startsWith(prefix))) {
      inMemory.delete(key);
      changed = true;
    }
  if (changed && !options.quiet) notify(sessionId);
  return changed;
}

/** Whether a session has any held sends, for anyone; cheap enough per fold. */
export function hasUnconfirmedSends(sessionId: string): boolean {
  if (storedKeys(sessionId).length > 0) return true;
  for (const key of inMemory.keys())
    if (key.startsWith(sessionPrefix(sessionId))) return true;
  return false;
}

/** Follow a session's unconfirmed prompts, including other tabs' changes. */
export function subscribeUnconfirmedSends(
  sessionId: string,
  listener: () => void
): () => void {
  const set = listeners.get(sessionId) ?? new Set();
  set.add(listener);
  listeners.set(sessionId, set);
  const prefix = sessionPrefix(sessionId);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix)) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener('storage', onStorage);
    set.delete(listener);
    if (set.size === 0) listeners.delete(sessionId);
  };
}

/** Forget what this page holds outside storage: sign-out, or a test's reload. */
export function forgetUnconfirmedSendsInMemory() {
  const sessions = new Set(
    [...inMemory.values()].map((send) => send.sessionId)
  );
  inMemory.clear();
  for (const sessionId of sessions) notify(sessionId);
}
