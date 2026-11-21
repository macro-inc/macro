import { z } from 'zod';

/**
 * Channels reconciliation deleted from the cache and has not yet read on the
 * primary since. The delete and the check before it are separate cache calls,
 * so a write that landed between them (the viewer was added back) was
 * deleted too; the read after the delete writes such a channel back. Kept in
 * localStorage, so a pass that stops after the delete, a retry with a new
 * fetcher, or another tab that takes over the lane still reads them: the
 * cache no longer holds them, so no later pass would find them on its own.
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

// What this tab saved when storage refused it, so this tab still reads its
// own obligations; a later write that storage takes drops the copy.
const unsaved = new Map<string, Stored>();

function storeKey(userId: string): string {
  return `channel-directory-rereads:v${STORE_VERSION}:${userId}`;
}

function load(userId: string): Stored | undefined {
  const key = storeKey(userId);
  const copy = unsaved.get(key);
  if (copy) return copy;
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return undefined;
    const parsed = STORED.safeParse(JSON.parse(saved));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

function save(userId: string, stored: Stored): void {
  const key = storeKey(userId);
  try {
    if (stored.ids.length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(stored));
    unsaved.delete(key);
  } catch {
    unsaved.set(key, stored);
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
 * the delete. */
export function addChannelRereads(
  userId: string,
  generation: string,
  ids: readonly string[]
): void {
  if (ids.length === 0) return;
  const owed = new Set(pendingChannelRereads(userId, generation));
  for (const id of ids) owed.add(id);
  save(userId, { generation, ids: [...owed] });
}

/** Drops channels the primary was read for, once its answer is in the
 * cache. */
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
