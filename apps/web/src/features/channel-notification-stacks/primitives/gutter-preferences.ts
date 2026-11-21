import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createStore } from 'solid-js/store';
import { z } from 'zod';
import type { NotificationListView } from '../core/channel-stacks';

const preferencesSchema = z.object({
  open: z.boolean(),
  view: z.enum(['not_done', 'unread']),
});

type GutterPreferences = { open: boolean; view: NotificationListView };

const storage = createUserScopedStorage('macro:channel:notification-list');

/**
 * Whether the gutter list is open and which stacks it lists, remembered per
 * person on this device and shared by every channel. It starts open on
 * the not-done stacks.
 */
export function createGutterPreferences(userId: string | undefined) {
  const [preferences, setPreferences] = makePersistedState(
    createStore<GutterPreferences>({ open: true, view: 'not_done' }),
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
    view: () => preferences.view,
    setOpen: (open: boolean) => setPreferences('open', open),
    setView: (view: NotificationListView) => setPreferences('view', view),
  };
}
