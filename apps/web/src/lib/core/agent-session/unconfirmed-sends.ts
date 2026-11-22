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

/** Every held send's key starts with this. */
export const UNCONFIRMED_SENDS_PREFIX = 'agent-session-unconfirmed:';

/**
 * A new chat's block id points here at the id its lost create held its
 * prompt under, when that differs (a warm id's fallback), so the block finds
 * it after a reload.
 */
export const HELD_AT_PREFIX = 'agent-session-held-at:';

/** Long enough to come back to after a bad connection, not forever. */
const UNCONFIRMED_SEND_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** The most a session keeps; older ones go first. */
const MAX_SENDS_PER_SESSION = 10;
/** The most this browser keeps across sessions. */
const MAX_SENDS_TOTAL = 100;
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

/**
 * Every stored key, by session: built by one scan of storage (which also
 * drops expired ones), then kept current by this page's writes and other
 * tabs' `storage` events, so a fold batch never scans storage.
 */
let index: Map<string, Set<string>> | undefined;
let followingOtherTabs = false;

const sessionOfKey = (key: string) =>
  key.slice(UNCONFIRMED_SENDS_PREFIX.length).split(':')[0] ?? '';

function storedIndex(): Map<string, Set<string>> {
  if (index) return index;
  index = new Map();
  const now = Date.now();
  const keys: string[] = [];
  try {
    for (let at = 0; at < localStorage.length; at++) {
      const key = localStorage.key(at);
      if (key?.startsWith(UNCONFIRMED_SENDS_PREFIX)) keys.push(key);
    }
  } catch {
    // Unreadable storage holds nothing.
  }
  for (const key of keys) {
    const stored = readKey(key);
    if (!stored || now - stored.heldAt > UNCONFIRMED_SEND_TTL_MS)
      removeKey(key);
    else indexKey(key);
  }
  if (!followingOtherTabs && typeof window !== 'undefined') {
    followingOtherTabs = true;
    window.addEventListener('storage', (event) => {
      if (event.key === null) {
        index = undefined;
        return;
      }
      if (!event.key.startsWith(UNCONFIRMED_SENDS_PREFIX)) return;
      if (event.newValue === null) unindexKey(event.key);
      else indexKey(event.key);
    });
  }
  return index;
}

function indexKey(key: string) {
  const map = index ?? storedIndex();
  const session = sessionOfKey(key);
  const keys = map.get(session) ?? new Set();
  keys.add(key);
  map.set(session, keys);
}

function unindexKey(key: string) {
  const keys = index?.get(sessionOfKey(key));
  keys?.delete(key);
  if (keys?.size === 0) index?.delete(sessionOfKey(key));
}

/** Keys in storage for this session, for anyone. */
function storedKeys(sessionId: string): string[] {
  return [...(storedIndex().get(sessionId) ?? [])];
}

/** Keeps storage under {@link MAX_SENDS_TOTAL}, dropping the oldest. */
function capTotal() {
  const all = [...storedIndex().values()].flatMap((keys) => [...keys]);
  if (all.length <= MAX_SENDS_TOTAL) return;
  const dated = all
    .map((key) => ({ key, heldAt: readKey(key)?.heldAt ?? 0 }))
    .sort((left, right) => left.heldAt - right.heldAt);
  const touched = new Set<string>();
  for (const { key } of dated.slice(0, all.length - MAX_SENDS_TOTAL)) {
    removeKey(key);
    touched.add(sessionOfKey(key));
  }
  for (const sessionId of touched) notify(sessionId);
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
  unindexKey(key);
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
      indexKey(key);
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
    capTotal();
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
  index = undefined;
  const sessions = new Set(
    [...inMemory.values()].map((send) => send.sessionId)
  );
  inMemory.clear();
  for (const sessionId of sessions) notify(sessionId);
}

/** Record that `blockId`'s lost create held its prompt under `heldId`. */
export function pointHeldSends(
  blockId: string,
  heldId: string,
  userId: string
) {
  if (blockId === heldId) return;
  try {
    localStorage.setItem(
      userScopedStorageKey(`${HELD_AT_PREFIX}${blockId}`, userId),
      JSON.stringify({ heldId, at: Date.now() })
    );
  } catch {
    // Without storage the page still knows it until a reload.
  }
}

/** Where `blockId`'s held sends live: a recorded fallback id, else itself. */
export function heldSendsAt(blockId: string, userId: string | undefined) {
  if (!userId) return blockId;
  const key = userScopedStorageKey(`${HELD_AT_PREFIX}${blockId}`, userId);
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw == null ? undefined : JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'heldId' in parsed &&
      typeof parsed.heldId === 'string' &&
      'at' in parsed &&
      typeof parsed.at === 'number'
    ) {
      if (Date.now() - parsed.at <= UNCONFIRMED_SEND_TTL_MS)
        return parsed.heldId;
      localStorage.removeItem(key);
    }
  } catch {
    // Unreadable: the block's own id.
  }
  return blockId;
}
