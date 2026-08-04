import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { type CustomToastConfig, toast } from './Toast';

/**
 * Keep exactly one persistent toast alive per keyed item in a reactive set.
 *
 * When an item leaves the set its toast is dismissed and its session dismissal
 * is forgotten, so a later reappearance prompts again. A user-dismissed key is
 * not re-prompted while the item remains in the set. All live toasts are
 * dismissed on owner cleanup.
 *
 * The factory receives a `dismiss` handle for action handlers that should
 * close the toast and suppress re-prompting for the session (e.g. after
 * kicking off a flow that will eventually remove the item from the set).
 */
export function useKeyedPersistentToasts<T>(options: {
  items: Accessor<readonly T[]>;
  key: (item: T) => string;
  toast: (item: T, dismiss: () => void) => CustomToastConfig;
}): void {
  const toastIds = new Map<string, number>();
  const dismissed = new Set<string>();

  const dismissToast = (key: string) => {
    const id = toastIds.get(key);
    if (id !== undefined) {
      toast.dismiss(id);
      toastIds.delete(key);
    }
  };

  createEffect(() => {
    const items = options.items();
    const liveKeys = new Set(items.map(options.key));

    for (const key of [...toastIds.keys()]) {
      if (!liveKeys.has(key)) dismissToast(key);
    }
    for (const key of [...dismissed]) {
      if (!liveKeys.has(key)) dismissed.delete(key);
    }

    for (const item of items) {
      const key = options.key(item);
      if (toastIds.has(key) || dismissed.has(key)) continue;

      const suppress = () => {
        dismissed.add(key);
        dismissToast(key);
      };
      const id = toast.custom(options.toast(item, suppress), {
        persistent: true,
        onDismiss: () => {
          toastIds.delete(key);
          dismissed.add(key);
        },
      });
      toastIds.set(key, id);
    }
  });

  onCleanup(() => {
    for (const key of [...toastIds.keys()]) dismissToast(key);
  });
}
