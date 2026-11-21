import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/index';
import { z } from 'zod';

/**
 * Sends the device queue has been handed but has not stored yet.
 *
 * The queue stores a write in a worker, which answers some milliseconds later
 * and up to a few hundred while a channel is opening. The message is on screen
 * for that time, so a reload inside it would lose a message the person saw
 * sent. Each send is therefore noted here first, synchronously, and forgotten
 * once the queue holds it; the next page to start sends what a page that is
 * gone left behind.
 */

const KEY_PREFIX = 'channel-send-awaiting-queue:v1:';
/** A send older than this is no longer what the person meant to say now. */
const MAX_AGE_MS = 24 * 60 * 60_000;

const mentionSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
});

const sendSchema = z.object({
  channelId: z.string(),
  id: z.string(),
  senderId: z.string(),
  message: z.object({
    content: z.string(),
    thread_id: z.string().nullish(),
    mentions: z.array(mentionSchema).optional(),
    attachments: z
      .array(
        mentionSchema.extend({
          width: z.number().nullish(),
          height: z.number().nullish(),
        })
      )
      .optional(),
  }),
});

const entrySchema = z.object({
  /** The page that noted the send; its lock tells whether it still runs. */
  pageId: z.string(),
  createdAt: z.string(),
  send: sendSchema,
});

export type UnqueuedSend = z.infer<typeof sendSchema>;
type Entry = z.infer<typeof entrySchema>;

export type UnqueuedSendsHost = Pick<CacheHost, 'inspectMutations'>;

export interface UnqueuedSendsDeps {
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & {
    readonly length: number;
  };
  locks?: Pick<LockManager, 'request' | 'query'>;
  pageId?: string;
  now?: () => number;
  /** Runs `work` a little later, if the page still runs then. */
  later?: (work: () => void) => void;
}

const PAGE_ID = crypto.randomUUID();

const pageLockName = (pageId: string) => `${KEY_PREFIX}page:${pageId}`;
const entryKey = (senderId: string, messageId: string) =>
  `${KEY_PREFIX}${senderId}:${messageId}`;

/** Forgets a noted send that reached the server some other way. */
export function forgetUnqueuedSend(
  senderId: string,
  messageId: string,
  deps: Pick<UnqueuedSendsDeps, 'storage'> = {}
): void {
  try {
    (deps.storage ?? browserStorage())?.removeItem(
      entryKey(senderId, messageId)
    );
  } catch {
    // It is sent again at the next start, and the server recognises its id.
  }
}

function browserStorage(): UnqueuedSendsDeps['storage'] {
  try {
    return globalThis.localStorage;
  } catch {
    // Storage the browser refuses leaves sends as they were before this.
    return undefined;
  }
}

async function holdForPageLifetime(): Promise<void> {
  await new Promise<never>(() => {});
}

let pageLockRequested = false;
let pageLeaving = false;

/**
 * Whether this page is being left. The cache host fails its requests in
 * flight then, which a send must not take for the queue refusing it.
 */
export function pageIsLeaving(): boolean {
  return pageLeaving;
}

function watchPageLeaving(): void {
  if (typeof addEventListener !== 'function') return;
  addEventListener(
    'pagehide',
    (event: Event) => {
      // A page kept for back and forward comes back as itself, and nothing
      // would resend for it.
      pageLeaving = !('persisted' in event && event.persisted === true);
    },
    { capture: true }
  );
  addEventListener('pageshow', () => {
    pageLeaving = false;
  });
}

/** Marks this page alive for as long as it runs. Call when the app starts. */
export function holdUnqueuedSendsPage(
  locks: UnqueuedSendsDeps['locks'] = globalThis.navigator?.locks
): void {
  if (pageLockRequested || !locks) return;
  pageLockRequested = true;
  watchPageLeaving();
  fireAndForget(
    locks.request(pageLockName(PAGE_ID), holdForPageLifetime),
    'channel-local-sync'
  );
}

function writeEntry(
  storage: NonNullable<UnqueuedSendsDeps['storage']>,
  entry: Entry
): void {
  try {
    storage.setItem(
      entryKey(entry.send.senderId, entry.send.id),
      JSON.stringify(entry)
    );
  } catch {
    // A full or refused storage leaves this send without the safety net.
  }
}

export interface UnqueuedSendNote {
  /** The queue holds the write: forget the note now. */
  stored: () => void;
  /**
   * The request to the queue ended some other way. A page being left fails its
   * requests in flight, which looks the same as the queue refusing the write,
   * so the note is forgotten only if the page still runs a moment later.
   */
  ended: () => void;
}

/** How long after a request ended a page counts as still running. */
const ENDED_GRACE_MS = 2_000;

const NO_NOTE: UnqueuedSendNote = { stored: () => {}, ended: () => {} };

/** Notes a send before the queue is asked to store it. */
export function noteUnqueuedSend(
  send: UnqueuedSend,
  createdAt: string,
  deps: UnqueuedSendsDeps = {}
): UnqueuedSendNote {
  const storage = deps.storage ?? browserStorage();
  if (!storage) return NO_NOTE;
  holdUnqueuedSendsPage(deps.locks);
  writeEntry(storage, { pageId: deps.pageId ?? PAGE_ID, createdAt, send });
  const key = entryKey(send.senderId, send.id);
  const stored = () => {
    try {
      storage.removeItem(key);
    } catch {
      // It is sent again at the next start, and the queue recognises its id.
    }
  };
  const later =
    deps.later ?? ((work: () => void) => setTimeout(work, ENDED_GRACE_MS));
  return { stored, ended: () => later(stored) };
}

function readEntries(
  storage: NonNullable<UnqueuedSendsDeps['storage']>,
  senderId: string
): { key: string; entry: Entry | undefined }[] {
  const prefix = `${KEY_PREFIX}${senderId}:`;
  const entries: { key: string; entry: Entry | undefined }[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    let stored: unknown;
    try {
      stored = JSON.parse(storage.getItem(key) ?? 'null');
    } catch {
      stored = undefined;
    }
    const parsed = entrySchema.safeParse(stored);
    entries.push({ key, entry: parsed.success ? parsed.data : undefined });
  }
  return entries;
}

/**
 * Sends again what pages that are gone noted for `senderId` and never saw
 * stored. Each such send is taken over by this page first, under a lock, so
 * two pages starting together do not both send it. Resolves with the number
 * handed to `resend`, which reports its own failures.
 */
export async function resendUnqueuedSends(
  host: UnqueuedSendsHost,
  senderId: string,
  resend: (send: UnqueuedSend, createdAt: string) => void,
  deps: UnqueuedSendsDeps = {}
): Promise<number> {
  const storage = deps.storage ?? browserStorage();
  const locks = deps.locks ?? globalThis.navigator?.locks;
  // Without locks a send still on its way cannot be told from one left behind.
  if (!storage || !locks) return 0;
  const pageId = deps.pageId ?? PAGE_ID;
  const now = deps.now?.() ?? Date.now();

  const adopted: Entry[] = [];
  await locks.request(`${KEY_PREFIX}resend:${senderId}`, async () => {
    const snapshot = await locks.query();
    const alive = new Set(
      [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].map(
        (lock) => lock.name
      )
    );
    for (const { key, entry } of readEntries(storage, senderId)) {
      // A time that does not parse is neither young nor sortable.
      if (!entry || !(now - Date.parse(entry.createdAt) <= MAX_AGE_MS)) {
        storage.removeItem(key);
        continue;
      }
      if (entry.pageId === pageId || alive.has(pageLockName(entry.pageId))) {
        continue;
      }
      const mine = { ...entry, pageId };
      writeEntry(storage, mine);
      adopted.push(mine);
    }
  });
  if (adopted.length === 0) return 0;
  // Storage lists its keys in no order a person would know; the sends go
  // out as they were written.
  adopted.sort(
    (a, b) =>
      Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
      (a.send.id < b.send.id ? -1 : 1)
  );

  // A send the queue stored just before its page went is already on its way.
  const queued = new Set(
    ((await host.inspectMutations?.()) ?? []).map((mutation) => mutation.uuid)
  );
  let resent = 0;
  for (const { send, createdAt } of adopted) {
    if (queued.has(send.id)) {
      storage.removeItem(entryKey(send.senderId, send.id));
      continue;
    }
    resent += 1;
    resend(send, createdAt);
  }
  return resent;
}
