import { z } from 'zod';

/**
 * Channels deleted from the cache and not yet read on the primary since. The
 * delete and the check before it are separate cache calls, so a write that
 * landed between them (the viewer was added back) was deleted too; the read
 * after the delete writes such a channel back. Kept in localStorage, so a
 * pass that stops after the delete, a retry with a new fetcher, a reload, or
 * another tab that takes over the lane still reads them: the cache no longer
 * holds them, so no later pass would find them on its own. The lane's
 * reconciliation and the directory's departure cleanup both owe here, and
 * the lane's next pass reads whatever either still owes.
 *
 * Each owed channel carries the mark of the delete that owed it, and a
 * settle drops only the marks it read for: a delete owed again after a read
 * was sent stays owed when that read settles, whoever owed either.
 *
 * A channel is owed before its delete is sent, and a read answered before
 * the delete lands says nothing about it: the delete would then erase what
 * the read wrote back. So `owedChannelRereads` leaves out deletes still in
 * flight: this tab's until `endChannelRereadDelete`, another tab's until
 * `DELETE_IN_FLIGHT_MS` after it was owed, so a tab closed mid-delete still
 * leaves its channels to be read.
 *
 * Kept per viewer for one cache storage generation: a reset storage holds
 * none of them and owes nothing.
 */
const STORE_VERSION = 3;

/** How long another tab's delete counts as in flight. The cache sets no
 * deadline on a delete; one still pending after this can again erase a
 * channel a read wrote back. */
export const DELETE_IN_FLIGHT_MS = 2 * 60_000;

const STORED = z.object({
  generation: z.string(),
  owed: z.record(
    z.string(),
    z.object({
      mark: z.string(),
      /** Until when the delete counts as in flight, in epoch ms; absent
       * once it has answered. */
      deletingUntil: z.number().optional(),
    })
  ),
});

type Stored = z.infer<typeof STORED>;

/** Owed channels, each with the mark of the delete that owed it. */
export type OwedRereads = Readonly<Record<string, string>>;

/** Marks of this tab's deletes that have not answered yet. */
const deleting = new Set<string>();

function storeKey(userId: string): string {
  return `channel-directory-rereads:v${STORE_VERSION}:${userId}`;
}

function load(userId: string): Stored | undefined {
  try {
    const saved = localStorage.getItem(storeKey(userId));
    if (!saved) return undefined;
    const parsed = STORED.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Whether storage took the write. */
function save(userId: string, stored: Stored): boolean {
  const key = storeKey(userId);
  try {
    if (Object.keys(stored.owed).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

function loadOwed(userId: string, generation: string): Stored['owed'] {
  const stored = load(userId);
  return stored?.generation === generation ? stored.owed : {};
}

/** The channels deleted in `generation` whose deletes have landed and that
 * were not read on the primary since, with their marks, for
 * `settleChannelRereads`. */
export function owedChannelRereads(
  userId: string,
  generation: string
): OwedRereads {
  const now = Date.now();
  const owed: Record<string, string> = {};
  for (const [id, entry] of Object.entries(loadOwed(userId, generation))) {
    if (deleting.has(entry.mark)) continue;
    if (entry.deletingUntil !== undefined && entry.deletingUntil > now)
      continue;
    owed[id] = entry.mark;
  }
  return owed;
}

/** Every channel owed in `generation`, its delete in flight or not. */
export function pendingChannelRereads(
  userId: string,
  generation: string
): string[] {
  return Object.keys(loadOwed(userId, generation));
}

/** Records, before they are deleted, channels to read on the primary after
 * the delete. Returns what it owed, to pass to `endChannelRereadDelete` once
 * the delete answers and to settle once read, or undefined when storage
 * refused them: then nothing would read them again once this page is gone,
 * so they must not be deleted. */
export function addChannelRereads(
  userId: string,
  generation: string,
  ids: readonly string[]
): OwedRereads | undefined {
  if (ids.length === 0) return {};
  const mark = crypto.randomUUID();
  const deletingUntil = Date.now() + DELETE_IN_FLIGHT_MS;
  const owed = { ...loadOwed(userId, generation) };
  const added: Record<string, string> = {};
  for (const id of ids) {
    added[id] = mark;
    owed[id] = { mark, deletingUntil };
  }
  if (!save(userId, { generation, owed })) return undefined;
  deleting.add(mark);
  return added;
}

/** Marks the deletes `added` owed as answered, landed or failed: a read sent
 * from now on can settle them. */
export function endChannelRereadDelete(
  userId: string,
  generation: string,
  added: OwedRereads
): void {
  const marks = new Set(Object.values(added));
  for (const mark of marks) deleting.delete(mark);
  const stored = load(userId);
  if (!stored || stored.generation !== generation) return;
  const owed: Stored['owed'] = {};
  for (const [id, entry] of Object.entries(stored.owed))
    owed[id] = marks.has(entry.mark) ? { mark: entry.mark } : entry;
  // A refused write leaves the delete in flight until its deadline: read
  // later, not lost.
  save(userId, { generation, owed });
}

/** Drops channels the primary was read for, once its answer is in the
 * cache: each only while it is still owed for the delete `read` names. A
 * write storage refuses leaves them owed, to be read once more. */
export function settleChannelRereads(
  userId: string,
  generation: string,
  read: OwedRereads
): void {
  const stored = load(userId);
  if (!stored || stored.generation !== generation) return;
  const owed: Stored['owed'] = {};
  for (const [id, entry] of Object.entries(stored.owed))
    if (read[id] !== entry.mark) owed[id] = entry;
  save(userId, { generation, owed });
}
