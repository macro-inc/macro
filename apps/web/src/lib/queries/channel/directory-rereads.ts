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
 * Kept per viewer for one cache storage generation: a reset storage holds
 * none of them and owes nothing.
 */
const STORE_VERSION = 2;

const STORED = z.object({
  generation: z.string(),
  owed: z.record(z.string(), z.string()),
});

type Stored = z.infer<typeof STORED>;

/** Owed channels, each with the mark of the delete that owed it. */
export type OwedRereads = Readonly<Record<string, string>>;

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

/** The channels deleted in `generation` and not read on the primary since,
 * with their marks, for `settleChannelRereads`. */
export function owedChannelRereads(
  userId: string,
  generation: string
): OwedRereads {
  const stored = load(userId);
  return stored?.generation === generation ? { ...stored.owed } : {};
}

/** The ids `owedChannelRereads` holds. */
export function pendingChannelRereads(
  userId: string,
  generation: string
): string[] {
  return Object.keys(owedChannelRereads(userId, generation));
}

/** Records, before they are deleted, channels to read on the primary after
 * the delete. Returns what it owed, to settle once read, or undefined when
 * storage refused them: then nothing would read them again once this page
 * is gone, so they must not be deleted. */
export function addChannelRereads(
  userId: string,
  generation: string,
  ids: readonly string[]
): OwedRereads | undefined {
  if (ids.length === 0) return {};
  const mark = crypto.randomUUID();
  const added: Record<string, string> = {};
  for (const id of ids) added[id] = mark;
  const owed = { ...owedChannelRereads(userId, generation), ...added };
  return save(userId, { generation, owed }) ? added : undefined;
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
  const owed: Record<string, string> = {};
  for (const [id, mark] of Object.entries(stored.owed))
    if (read[id] !== mark) owed[id] = mark;
  save(userId, { generation, owed });
}
