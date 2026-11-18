import { createSignal } from 'solid-js';

// A work hint, not a directory or query-history cache. A running scan finishes
// before the next coalesced refresh; events never rewind its cursor.
export const [contactRefreshRevision, requestContactRefresh] = (() => {
  const [revision, setRevision] = createSignal(0);
  return [revision, () => setRevision((value) => value + 1)] as const;
})();

// Also a work hint: whether a contact window in this tab reads the published
// context, so the publisher can leave its inputs stale while none does.
export const [contactReadersOpen, openContactReader] = (() => {
  const [open, setOpen] = createSignal(0);
  return [
    () => open() > 0,
    () => {
      setOpen((count) => count + 1);
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        setOpen((count) => count - 1);
      };
    },
  ] as const;
})();
