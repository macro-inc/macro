import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createStore } from 'solid-js/store';
import { z } from 'zod';

const preferencesSchema = z.object({
  open: z.boolean(),
});

type GutterPreferences = { open: boolean };

const storage = createUserScopedStorage('macro:channel:notification-list');

/**
 * Whether the gutter list is open, remembered per person on this device and
 * shared by every channel. It starts open.
 */
export function createGutterPreferences(userId: string | undefined) {
  const [preferences, setPreferences] = makePersistedState(
    createStore<GutterPreferences>({ open: true }),
    {
      storages: {
        restore: () => {
          if (!userId) return;
          const raw = storage.read(userId);
          if (!raw) return;
          const parsed = preferencesSchema.safeParse(JSON.parse(raw));
          return parsed.success ? parsed.data : undefined;
        },
        write: (value) => {
          if (userId) storage.write(userId, JSON.stringify(value));
        },
      },
    }
  );

  return {
    open: () => preferences.open,
    setOpen: (open: boolean) => setPreferences('open', open),
  };
}
