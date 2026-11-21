import { z } from 'zod';

/**
 * Channel reads the views were answered from the server that the device does
 * not hold yet: a channel's latest page, or a whole thread.
 *
 * The device stores such a read a moment after the views show it, and only
 * once its cache has started, which takes a second or two on a new page. A
 * reload inside that time would leave the device without what the person just
 * read, and offline it would not open. Each such read is therefore noted here
 * first, synchronously, and forgotten once the device holds it; the next page
 * to start has the device hold what a page that is gone left noted.
 */

const KEY = 'channel-read-awaiting-device:v1';
/** Only the latest reads are worth holding again. */
const MAX_NOTED = 50;

export interface UnheldRead {
  channelId: string;
  /** The thread that was read; absent for the channel's latest page. */
  rootId?: string;
}

const notedSchema = z.array(
  z.object({ channelId: z.string(), rootId: z.string().optional() })
);

/** What this page noted and has not seen held. */
const noted = new Set<string>();

const idOf = (read: UnheldRead) =>
  read.rootId === undefined
    ? read.channelId
    : `${read.channelId}:${read.rootId}`;

function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    // Storage the browser refuses leaves reads as they were before this.
    return undefined;
  }
}

/** The reads a page noted and did not see held, this one's included. */
export function unheldReads(): UnheldRead[] {
  try {
    const parsed = notedSchema.safeParse(
      JSON.parse(browserStorage()?.getItem(KEY) ?? '[]')
    );
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function write(reads: UnheldRead[]): void {
  try {
    browserStorage()?.setItem(KEY, JSON.stringify(reads));
  } catch {
    // A full or refused storage leaves the read to the channel prewarm.
  }
}

/** The reads pages that are gone left noted: not the ones this page is storing. */
export function unheldReadsLeft(): UnheldRead[] {
  return unheldReads().filter((read) => !noted.has(idOf(read)));
}

export function noteUnheldRead(read: UnheldRead): void {
  const id = idOf(read);
  if (noted.has(id)) return;
  noted.add(id);
  const others = unheldReads().filter((other) => idOf(other) !== id);
  const kept = [...others, read].slice(-MAX_NOTED);
  // A note pushed out may be noted again by a later read.
  for (const dropped of others.slice(0, others.length + 1 - kept.length)) {
    noted.delete(idOf(dropped));
  }
  write(kept);
}

/**
 * The device holds the read. Touches storage only for a read this page noted,
 * unless `left` says an earlier page may have.
 */
export function forgetUnheldRead(read: UnheldRead, left = false): void {
  const id = idOf(read);
  if (!noted.delete(id) && !left) return;
  const held = unheldReads();
  if (held.some((other) => idOf(other) === id)) {
    write(held.filter((other) => idOf(other) !== id));
  }
}

/** For tests. */
export function resetUnheldReads(): void {
  noted.clear();
}
