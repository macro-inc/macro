import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import { z } from 'zod';

const orderSchema = z.array(z.string());
const storage = createUserScopedStorage('macro:mobile:dock-order');

/** Keep gated destinations in the saved order and append newly added views. */
export function normalizeDockOrder(
  saved: readonly string[],
  defaults: readonly string[]
) {
  const known = new Set(defaults);
  return [...new Set([...saved.filter((id) => known.has(id)), ...defaults])];
}

export function createMobileDockOrder(
  userId: string | undefined,
  defaults: readonly string[]
) {
  const [order, setOrder] = makePersistedState(createSignal([...defaults]), {
    storages: {
      restore: () => {
        if (!userId) return;
        const raw = storage.read(userId);
        if (!raw) return;
        const parsed = orderSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return normalizeDockOrder(parsed.data, defaults);
      },
      write: (value) => {
        if (userId) storage.write(userId, JSON.stringify(value));
      },
    },
  });

  function move(from: number, to: number, visibleIds: readonly string[]) {
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= visibleIds.length ||
      to >= visibleIds.length
    )
      return;
    const next = [...visibleIds];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const visible = new Set(visibleIds);
    let index = 0;
    // Replace only enabled slots, preserving preferences for gated views.
    setOrder((current) =>
      current.map((id) => (visible.has(id) ? next[index++] : id))
    );
  }

  return { order, move };
}

export function dockVisibleCount(
  width: number | null,
  height: number | null,
  count: number
) {
  if (!height || !width) return 0;
  return Math.min(count, Math.max(0, Math.floor(width / height) - 1));
}
