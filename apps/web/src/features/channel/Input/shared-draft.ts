import { makePersisted } from '@solid-primitives/storage';
import { createRoot, createSignal, onCleanup, type Signal } from 'solid-js';

type Shared<T> = {
  value: T;
  holders: number;
  dispose: () => void;
};

/**
 * Every input mounted on one stored draft at once, like a channel open in two
 * desktop tabs or the Agents page and the phone list's composer, shares one
 * copy of it. An input with its own copy would write it back over newer
 * changes made in the other. A copy is dropped once no input holds it, so the
 * next mount reads storage again. Call `hold` inside the owner that uses it.
 */
export function createSharedDrafts<T>() {
  const registry = new Map<string, Shared<T>>();

  return function hold(name: string, create: () => T): T {
    let shared = registry.get(name);
    if (!shared) {
      shared = createRoot((dispose) => ({
        value: create(),
        holders: 0,
        dispose,
      }));
      registry.set(name, shared);
    }

    const held = shared;
    held.holders += 1;
    onCleanup(() => {
      held.holders -= 1;
      if (held.holders > 0) return;
      registry.delete(name);
      held.dispose();
    });
    return held.value;
  };
}

const holdDraftText = createSharedDrafts<Signal<string | undefined>>();

/** The unsent text stored under `name`, shared by every input holding it. */
export function holdPersistedDraftText(
  name: string,
  initialValue?: string
): Signal<string | undefined> {
  return holdDraftText(name, () => {
    const [text, setText] = makePersisted(
      createSignal<string | undefined>(initialValue),
      { name }
    );
    return [text, setText];
  });
}
