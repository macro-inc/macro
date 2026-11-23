import {
  type Accessor,
  createEffect,
  createRoot,
  getOwner,
  on,
  onCleanup,
  untrack,
} from 'solid-js';

export type ReplaceOwnedSlot = <T>(name: string, factory: () => T) => T;

export type OwnedSlots = {
  replace: ReplaceOwnedSlot;
};

type Slot = {
  dispose: () => void;
  /** The view the panel was in when the slot was made. */
  view: string | undefined;
};

/**
 * Named resources that outlive the component that made them, so a detail can
 * still reach the list it was opened from. With `view`, a slot lasts until its
 * name is reused or the panel moves to another view; without it, until its
 * name is reused or the panel closes.
 */
export function createOwnedSlots(
  view?: Accessor<string | undefined>
): OwnedSlots {
  const owner = getOwner();
  if (!owner) {
    throw new Error('createOwnedSlots requires a Solid owner');
  }

  const slots = new Map<string, Slot>();

  function replace<T>(name: string, factory: () => T): T {
    let disposeNext: (() => void) | undefined;
    let value: T;

    try {
      value = createRoot((dispose) => {
        disposeNext = dispose;
        return factory();
      }, owner);
    } catch (error) {
      disposeNext?.();
      throw error;
    }

    if (!disposeNext) {
      throw new Error(`Owned slot "${name}" did not provide a disposer`);
    }

    const previous = slots.get(name);
    slots.set(name, { dispose: disposeNext, view: view && untrack(view) });
    previous?.dispose();

    return value;
  }

  if (view) {
    // A slot's disposer closes over the view that made it, so slots left from
    // an earlier view would keep that view and its DOM alive.
    createEffect(
      on(
        view,
        (current) => {
          for (const [name, slot] of slots) {
            if (slot.view === current) continue;
            slots.delete(name);
            slot.dispose();
          }
        },
        { defer: true }
      )
    );
  }

  onCleanup(() => {
    for (const slot of slots.values()) {
      slot.dispose();
    }
    slots.clear();
  });

  return { replace };
}
