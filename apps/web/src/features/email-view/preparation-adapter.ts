import { prepareEmailThreads } from '@app/features/email-thread/preparation-adapter';
import { useEmailRenderCache } from '@app/lib/email-render-cache/session';
import { type Accessor, createEffect, createMemo, onCleanup } from 'solid-js';

/** Host-owned intent. Cancels obsolete leases without changing list authority. */
export function usePrepareEmailNeighbors(
  ids: Accessor<readonly string[]>,
  focusedId: Accessor<string | undefined>
) {
  const cache = useEmailRenderCache();
  const candidates = createMemo(
    () => {
      const focused = focusedId();
      const ordered = ids();
      const index = focused ? ordered.indexOf(focused) : -1;
      return index < 0
        ? []
        : [index, index + 1, index - 1, index + 2, index - 2]
            .filter((position) => position >= 0 && position < ordered.length)
            .map((position) => ordered[position]);
    },
    undefined,
    {
      equals: (a, b) =>
        a.length === b.length && a.every((id, index) => id === b[index]),
    }
  );
  const retained = new Map<string, () => void>();
  let owner: ReturnType<typeof cache>;
  const clear = () => {
    for (const release of retained.values()) release();
    retained.clear();
  };
  onCleanup(clear);
  createEffect(() => {
    const service = cache();
    const selected = candidates();
    if (service !== owner) {
      clear();
      owner = service;
    }
    for (const [id, release] of retained) {
      if (!selected.includes(id)) {
        release();
        retained.delete(id);
      }
    }
    if (!service || !selected.length) return;
    // A short intent delay avoids work on every pointer movement across rows.
    const timer = setTimeout(() => {
      selected.forEach((id, index) => {
        if (!retained.has(id))
          retained.set(
            id,
            prepareEmailThreads(service, [id], index === 0 ? 1 : 2)
          );
      });
    }, 75);
    onCleanup(() => {
      clearTimeout(timer);
    });
  });
}
