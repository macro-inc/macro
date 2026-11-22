import { z } from 'zod';

/**
 * Channels reconciliation deleted from the cache and has not yet read on the
 * primary since. The delete and the check before it are separate cache calls,
 * so a write that landed between them (the viewer was added back) was
 * deleted too; the read after the delete writes such a channel back. Kept in
 * localStorage, so a pass that stops after the delete, a retry with a new
 * fetcher, or another tab that takes over the lane still reads them: the
 * cache no longer holds them, so no later pass would find them on its own.
 * Reconciliation deletes only what this store took.
 *
 * Kept per viewer for one cache storage generation: a reset storage holds
 * none of them and owes nothing.
 */
const STORE_VERSION = 1;

const STORED = z.object({
  generation: z.string(),
  ids: z.array(z.string()),
});

type Stored = z.infer<typeof STORED>;

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
    if (stored.ids.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/** The channels deleted in `generation` and not read on the primary since. */
export function pendingChannelRereads(
  userId: string,
  generation: string
): string[] {
  const stored = load(userId);
  return stored?.generation === generation ? [...stored.ids] : [];
}

/** Records, before they are deleted, channels to read on the primary after
 * the delete. Returns false when storage refused them: then nothing would
 * read them again once this page is gone, so they must not be deleted. */
export function addChannelRereads(
  userId: string,
  generation: string,
  ids: readonly string[]
): boolean {
  if (ids.length === 0) return true;
  const owed = new Set(pendingChannelRereads(userId, generation));
  for (const id of ids) owed.add(id);
  return save(userId, { generation, ids: [...owed] });
}

/** Drops channels the primary was read for, once its answer is in the
 * cache. A write storage refuses leaves them owed, to be read once more. */
export function settleChannelRereads(
  userId: string,
  generation: string,
  ids: readonly string[]
): void {
  const settled = new Set(ids);
  const stored = load(userId);
  if (!stored || stored.generation !== generation) return;
  save(userId, {
    generation,
    ids: stored.ids.filter((id) => !settled.has(id)),
  });
}
