import { makePersistedState } from '@app/lib/persistence';
import { useUserId } from '@core/context/user';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createMemo, createSignal } from 'solid-js';
import { z } from 'zod';
import { SIDEBAR_NEXT_NAV_ITEMS } from './nav-items';

/** Pinned until someone changes them: Email, Calendar, Tasks, Drive. */
export const DEFAULT_SINGLE_SIDEBAR_PINS = [
  'mail',
  'calendar',
  'tasks',
  'documents',
] as const;

const pinsSchema = z.array(z.string());
const storage = createUserScopedStorage('macro:single-sidebar:pins');
const KNOWN_IDS = new Set<string>(
  SIDEBAR_NEXT_NAV_ITEMS.map((item) => item.id)
);

/** Saved pins without ids the catalog no longer has, each once, in order. */
export function normalizePins(saved: readonly string[]): string[] {
  return [...new Set(saved.filter((id) => KNOWN_IDS.has(id)))];
}

/**
 * The single sidebar's pinned destinations, in order, saved per user. A
 * destination the account can't see stays saved and is skipped on display.
 */
export function useSingleSidebarPins() {
  const userId = useUserId();
  const pinsFor = createMemo(() => {
    const id = userId();
    const [pins, setPins] = makePersistedState(
      createSignal<string[]>([...DEFAULT_SINGLE_SIDEBAR_PINS]),
      {
        storages: {
          restore: () => {
            if (!id) return;
            const raw = storage.read(id);
            if (!raw) return;
            const parsed = pinsSchema.safeParse(JSON.parse(raw));
            if (parsed.success) return normalizePins(parsed.data);
          },
          write: (value) => {
            if (id) storage.write(id, JSON.stringify(value));
          },
        },
      }
    );
    return { pins, setPins };
  });

  const pins = () => pinsFor().pins();
  const isPinned = (id: string) => pins().includes(id);
  const setPinned = (id: string, pinned: boolean) =>
    pinsFor().setPins((current) =>
      pinned
        ? normalizePins([...current, id])
        : current.filter((pin) => pin !== id)
    );

  return { pins, isPinned, setPinned };
}
