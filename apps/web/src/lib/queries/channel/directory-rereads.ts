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
 * Each delete owes its channels under a mark of its own, and a channel keeps
 * every mark owed for it: two deletes of one channel can be in flight at
 * once and answer in either order, and the cache does not order them. A
 * settle drops only the marks it read for, so a delete owed after a read
 * was sent stays owed when that read settles, whoever owed either.
 *
 * A channel is owed before its delete is sent, and a read answered before
 * the delete lands says nothing about it: the delete would then erase what
 * the read wrote back. So `owedChannelRereads` leaves out a channel while
 * any delete of it is still in flight: this tab's until
 * `endChannelRereadDelete`, another tab's until `DELETE_IN_FLIGHT_MS` after
 * it was owed, so a tab closed mid-delete still leaves its channels to be
 * read.
 *
 * Kept per viewer and cache storage generation: a reset storage holds none
 * of them and owes nothing. A pass still running for an older generation can
 * owe after a newer one has begun, so each generation keeps its own entries,
 * and only the `KEPT_GENERATIONS` written to most recently are kept.
 */
const STORE_VERSION = 4;

/** How long another tab's delete counts as in flight. The cache sets no
 * deadline on a delete; one still pending after this can again erase a
 * channel a read wrote back. */
export const DELETE_IN_FLIGHT_MS = 2 * 60_000;

/** Generations kept per viewer. Only the current one is read; the others
 * stay so an older pass's write cannot replace it. */
const KEPT_GENERATIONS = 3;

const OWED_DELETE = z.object({
  mark: z.string(),
  /** Until when the delete counts as in flight, in epoch ms; absent once it
   * has answered. */
  deletingUntil: z.number().optional(),
});

type OwedDelete = z.infer<typeof OWED_DELETE>;

const GENERATION = z.object({
  /** When this generation was last written, in epoch ms. */
  touched: z.number(),
  owed: z.record(z.string(), z.array(OWED_DELETE)),
});

type Generation = z.infer<typeof GENERATION>;

const STORED = z.record(z.string(), GENERATION);

type Stored = z.infer<typeof STORED>;

/** Owed channels, each with the marks of the deletes that owed it. */
export type OwedRereads = Readonly<Record<string, readonly string[]>>;

/** Marks of this tab's deletes that have not answered yet. */
const deleting = new Set<string>();

function storeKey(userId: string): string {
  return `channel-directory-rereads:v${STORE_VERSION}:${userId}`;
}

function load(userId: string): Stored {
  try {
    const saved = localStorage.getItem(storeKey(userId));
    if (!saved) return {};
    const parsed = STORED.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Writes `owed` as `generation`'s entries, keeping the other generations
 * written to most recently. Whether storage took the write. The generation
 * written is always kept, whatever another tab's clock stamped the others:
 * a caller deletes only once its entry is saved. */
function save(
  userId: string,
  generation: string,
  owed: Generation['owed']
): boolean {
  const key = storeKey(userId);
  const { [generation]: _replaced, ...others } = load(userId);
  const owes = Object.keys(owed).length > 0;
  const kept = Object.entries(others)
    .sort(([, a], [, b]) => b.touched - a.touched)
    .slice(0, owes ? KEPT_GENERATIONS - 1 : KEPT_GENERATIONS);
  if (owes) kept.unshift([generation, { touched: Date.now(), owed }]);
  try {
    if (kept.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(Object.fromEntries(kept)));
    return true;
  } catch {
    return false;
  }
}

function loadOwed(userId: string, generation: string): Generation['owed'] {
  return load(userId)[generation]?.owed ?? {};
}

function inFlight(entry: OwedDelete, now: number): boolean {
  if (deleting.has(entry.mark)) return true;
  return entry.deletingUntil !== undefined && entry.deletingUntil > now;
}

/** The channels deleted in `generation` whose deletes have all landed and
 * that were not read on the primary since, with their marks, for
 * `settleChannelRereads`. */
export function owedChannelRereads(
  userId: string,
  generation: string
): OwedRereads {
  const now = Date.now();
  const owed: Record<string, string[]> = {};
  for (const [id, entries] of Object.entries(loadOwed(userId, generation))) {
    if (entries.some((entry) => inFlight(entry, now))) continue;
    owed[id] = entries.map((entry) => entry.mark);
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
  const added: Record<string, string[]> = {};
  for (const id of ids) {
    added[id] = [mark];
    owed[id] = [...(owed[id] ?? []), { mark, deletingUntil }];
  }
  if (!save(userId, generation, owed)) return undefined;
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
  const marks = new Set(Object.values(added).flat());
  for (const mark of marks) deleting.delete(mark);
  const stored = load(userId)[generation];
  if (!stored) return;
  const owed: Generation['owed'] = {};
  for (const [id, entries] of Object.entries(stored.owed))
    owed[id] = entries.map((entry) =>
      marks.has(entry.mark) ? { mark: entry.mark } : entry
    );
  // A refused write leaves the delete in flight until its deadline: read
  // later, not lost.
  save(userId, generation, owed);
}

/** Drops channels the primary was read for, once its answer is in the
 * cache: of each, only the deletes `read` names. A write storage refuses
 * leaves them owed, to be read once more. */
export function settleChannelRereads(
  userId: string,
  generation: string,
  read: OwedRereads
): void {
  const stored = load(userId)[generation];
  if (!stored) return;
  const owed: Generation['owed'] = {};
  for (const [id, entries] of Object.entries(stored.owed)) {
    const settled = new Set(read[id] ?? []);
    const left = entries.filter((entry) => !settled.has(entry.mark));
    if (left.length > 0) owed[id] = left;
  }
  save(userId, generation, owed);
}
