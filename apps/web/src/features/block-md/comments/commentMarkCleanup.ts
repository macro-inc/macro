import type { WALStore } from '@macro-inc/collaboration/collab/wal';

/** Only cancelled publications with no pending or uncertain message write enter here. */
export function createCommentMarkCleanup(
  store: WALStore<string>,
  remove: (markId: string) => Promise<boolean>
) {
  let pending: Promise<void> | undefined;
  let rerun = false;

  async function drain() {
    for (const entry of await store.getAll()) {
      if (!entry.delivered && (await remove(entry.update)))
        await store.markDelivered([entry.id]);
    }
    await store.pruneDelivered();
  }

  async function flush() {
    if (pending) {
      rerun = true;
      return pending;
    }
    const drainRequested = async () => {
      do {
        rerun = false;
        try {
          await drain();
        } catch (error) {
          if (!rerun) throw error;
        }
      } while (rerun);
    };
    pending = drainRequested();
    try {
      await pending;
    } finally {
      pending = undefined;
    }
  }

  return {
    flush,
    async enqueue(markId: string) {
      // Persist before trying the network. Unlike document edits, abandoned
      // anchor removals do not expire while this document remains unopened.
      await store.append(markId);
      await flush();
    },
  };
}
