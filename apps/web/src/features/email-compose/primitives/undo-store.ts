/** Draft-keyed snapshots and reply-keyed remount recovery. No reactive or application state. */
export function createEmailUndoStore<Snapshot extends { draftId: string }>() {
  const sent = new Map<string, Snapshot>();
  const pending = new Map<string, Snapshot>();
  const listeners = new Map<string, (snapshot: Snapshot) => void>();
  const remember = (snapshot: Snapshot) => {
    sent.set(snapshot.draftId, snapshot);
    // Only the recent send toast offers Undo; keep a small bounded recovery history.
    if (sent.size > 50) sent.delete(sent.keys().next().value!);
  };
  return {
    remember,
    peek: (draftId: string) => sent.get(draftId),
    take(draftId: string) {
      const snapshot = sent.get(draftId);
      sent.delete(draftId);
      return snapshot;
    },
    takePending(key: string) {
      const snapshot = pending.get(key);
      pending.delete(key);
      return snapshot;
    },
    restore(key: string, snapshot: Snapshot) {
      const listener = listeners.get(key);
      if (listener) {
        listener(snapshot);
        return;
      }
      pending.set(key, snapshot);
      if (pending.size > 50) pending.delete(pending.keys().next().value!);
    },
    register(key: string, listener: (snapshot: Snapshot) => void) {
      listeners.set(key, listener);
      return () => {
        if (listeners.get(key) === listener) listeners.delete(key);
      };
    },
  };
}
