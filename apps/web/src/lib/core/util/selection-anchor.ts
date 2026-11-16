import { type Accessor, createEffect, on, untrack } from 'solid-js';

/** Keeps the highlight on the row the user chose while results arrive, leave,
 * or reorder around it. A row is held only for the scope (query, category) it
 * was chosen in; an untouched default highlight stays positional. */
export function createSelectionAnchor<T>(options: {
  items: Accessor<readonly T[]>;
  key: (item: T) => string;
  scope: Accessor<unknown>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: (index: number) => void;
}) {
  let held: { key: string; scope: unknown } | undefined;
  const current = () => {
    if (held && held.scope !== untrack(options.scope)) held = undefined;
    return held;
  };
  createEffect(
    on(options.items, (items) => {
      const anchor = current();
      if (!anchor) return;
      const index = items.findIndex((item) => options.key(item) === anchor.key);
      if (index >= 0 && index !== untrack(options.selectedIndex))
        options.setSelectedIndex(index);
    })
  );
  return {
    /** Call after the user moves the highlight. */
    hold: () => {
      const item = untrack(options.items)[untrack(options.selectedIndex)];
      held = item
        ? { key: options.key(item), scope: untrack(options.scope) }
        : undefined;
    },
    release: () => {
      held = undefined;
    },
    /** Whether the held row is still listed. */
    present: () => {
      const anchor = current();
      return (
        !!anchor &&
        untrack(options.items).some((item) => options.key(item) === anchor.key)
      );
    },
    holding: () => current() !== undefined,
  };
}
