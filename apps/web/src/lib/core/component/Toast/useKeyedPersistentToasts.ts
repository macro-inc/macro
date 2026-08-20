import { isMobile } from '@core/mobile/isMobile';
import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { type CustomToastConfig, toast } from './Toast';

function readDismissed(storageKey: string): string[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(
      localStorage.getItem(storageKey) ?? '[]'
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key): key is string => typeof key === 'string');
  } catch {
    return [];
  }
}

function writeDismissed(storageKey: string, keys: Iterable<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...keys]));
  } catch {
    // Storage may be unavailable or full. In-memory dismissal still works.
  }
}

/**
 * Keep exactly one persistent toast alive per keyed item in a reactive set.
 *
 * When an item leaves the set its toast is dismissed and its dismissal is
 * forgotten, so a later reappearance prompts again. A user-dismissed key is
 * not re-prompted while the item remains in the set. All live toasts are
 * dismissed on owner cleanup.
 *
 * The factory receives a `dismiss` handle for action handlers that should
 * close the toast and suppress re-prompting for the session (e.g. after
 * kicking off a flow that will eventually remove the item from the set).
 *
 * Every toast is created eagerly into the layout's prompt region, whose
 * `limit` shows one prompt at a time and queues the rest in creation order —
 * unrelated prompt hooks take turns instead of stacking, with mount order
 * deciding who goes first. `persistKey` carries closes across reloads — see
 * below.
 */
export function useKeyedPersistentToasts<T>(options: {
  items: Accessor<readonly T[]>;
  key: (item: T) => string;
  toast: (item: T, dismiss: () => void) => CustomToastConfig;
  /**
   * localStorage key under which explicit user dismissals are remembered
   * across reloads. Set it for advisory prompts, where re-asking on every
   * load is nagging and the action stays reachable elsewhere (e.g.
   * settings). Leave it unset for prompts that must keep re-surfacing until
   * resolved, like a dead inbox grant.
   *
   * Only a close counts: taking the action, or the toast being torn down
   * for us, still re-prompts next session if the item is still there.
   */
  persistKey?: string;
  /**
   * Whether `items` currently reflects real server state rather than a
   * query that has not answered yet. Both look like an empty list from in
   * here, and treating "still loading" as "the item is gone" would forget
   * dismissals the moment the app starts. Defaults to true, which is right
   * for a set that is synchronously derived.
   */
  itemsLoaded?: Accessor<boolean>;
}): void {
  /**
   * A shown toast. Tracked by object identity rather than by key alone: a
   * toast unmounts at the end of its exit animation, by which point the key
   * may already belong to a replacement, and the departing toast must not
   * retract or answer for it.
   */
  type LiveToast = { id: number };

  const live = new Map<string, LiveToast>();
  const dismissed = new Set<string>();
  /**
   * Toasts we tore down ourselves. Their `onDismiss` reports our own teardown
   * — item left the set, action taken, owner disposed — rather than a user
   * decision, so it must not be recorded as one. An entry whose toast was
   * still queued (never rendered) has no unmount and simply stays here;
   * that's harmless.
   */
  const selfDismissed = new Set<LiveToast>();

  const persistKey = options.persistKey;
  const persisted = new Set(persistKey ? readDismissed(persistKey) : []);
  for (const key of persisted) dismissed.add(key);

  const dismissToast = (key: string) => {
    const entry = live.get(key);
    if (entry) {
      selfDismissed.add(entry);
      // Kobalte tears a dismissed toast out of the region in the same
      // synchronous update, so its onDismiss can fire inside this call —
      // the entry must already be gone from `live` by then.
      live.delete(key);
      toast.dismiss(entry.id);
    }
  };

  const forget = (key: string) => {
    dismissed.delete(key);
    if (persistKey && persisted.delete(key)) {
      writeDismissed(persistKey, persisted);
    }
  };

  createEffect(() => {
    const items = options.items();
    const liveKeys = new Set(items.map(options.key));

    for (const key of [...live.keys()]) {
      if (!liveKeys.has(key)) dismissToast(key);
    }
    if (options.itemsLoaded?.() ?? true) {
      for (const key of [...dismissed]) {
        if (!liveKeys.has(key)) forget(key);
      }
    }

    for (const item of items) {
      const key = options.key(item);
      if (live.has(key) || dismissed.has(key)) continue;

      const suppress = () => {
        dismissed.add(key);
        dismissToast(key);
      };
      const entry: LiveToast = { id: 0 };
      entry.id = toast.custom(options.toast(item, suppress), {
        persistent: true,
        // The prompt region caps how many of these are visible and queues
        // the rest, so every eligible item gets its toast created eagerly.
        region: isMobile() ? 'mobile-prompt-region' : 'prompt-region',
        onDismiss: () => {
          // Only retract ourselves; the key may already hold a replacement.
          if (live.get(key) === entry) live.delete(key);
          // Our own teardown already left `dismissed` how it wants it, and
          // the unmount can land after the item was forgotten — re-adding
          // here would strand a returning item.
          if (selfDismissed.delete(entry)) return;

          dismissed.add(key);
          if (persistKey && !persisted.has(key)) {
            persisted.add(key);
            writeDismissed(persistKey, persisted);
          }
        },
      });
      live.set(key, entry);
    }
  });

  onCleanup(() => {
    for (const key of [...live.keys()]) dismissToast(key);
  });
}
