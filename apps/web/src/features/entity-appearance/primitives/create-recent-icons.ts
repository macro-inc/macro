import { makePersistedState } from '@app/lib/persistence';
import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { createSignal } from 'solid-js';
import { z } from 'zod';
import type { EntityAppearance } from '../core/appearance';
import { PICKER_ICON_NAMES } from '../core/catalog';

type AppearanceIcon = NonNullable<EntityAppearance['icon']>;
const STORAGE = createUserScopedStorage('entity-icons:recent');
const recentIconSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('macro'), name: z.enum(PICKER_ICON_NAMES) }),
  z.object({ kind: z.literal('emoji'), value: z.string().min(1) }),
]);
const recentIconsSchema = z.array(z.unknown()).transform((entries) =>
  entries
    .flatMap((entry) => {
      const parsed = recentIconSchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, 9)
);

/** Picker preferences belong to the signed-in account, not the entity. */
export function createRecentIcons(userId: string) {
  const [icons, setIcons] = makePersistedState(
    createSignal<AppearanceIcon[]>([]),
    {
      storages: {
        restore: () => {
          const raw = STORAGE.read(userId);
          if (!raw) return;
          const parsed = recentIconsSchema.safeParse(JSON.parse(raw));
          if (parsed.success) return parsed.data;
        },
        write: (value) => STORAGE.write(userId, JSON.stringify(value)),
      },
    }
  );
  function record(icon: AppearanceIcon) {
    setIcons((previous) =>
      [
        icon,
        ...previous.filter(
          (entry) => JSON.stringify(entry) !== JSON.stringify(icon)
        ),
      ].slice(0, 9)
    );
  }
  return { icons, record };
}
