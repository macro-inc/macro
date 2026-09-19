import { createRoot, getOwner, onCleanup } from 'solid-js';

export type ReplaceOwnedSlot = <T>(name: string, factory: () => T) => T;

export type OwnedSlots = {
  replace: ReplaceOwnedSlot;
};

export function createOwnedSlots(): OwnedSlots {
  const owner = getOwner();
  if (!owner) {
    throw new Error('createOwnedSlots requires a Solid owner');
  }

  const disposers = new Map<string, () => void>();

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

    const disposePrevious = disposers.get(name);
    disposers.set(name, disposeNext);
    disposePrevious?.();

    return value;
  }

  onCleanup(() => {
    for (const dispose of disposers.values()) {
      dispose();
    }
    disposers.clear();
  });

  return { replace };
}
