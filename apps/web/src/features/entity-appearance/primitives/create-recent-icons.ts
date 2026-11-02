import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import {
  type EntityAppearance,
  readEntityAppearance,
} from '../core/appearance';
import { PICKER_ICON_NAMES } from '../core/catalog';

type AppearanceIcon = NonNullable<EntityAppearance['icon']>;

function readRecentIcons(raw: string): AppearanceIcon[] {
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values)) return [];
  return values
    .flatMap((icon) => {
      const value = readEntityAppearance({ icon, color: null })?.icon;
      if (!value) return [];
      if (
        value.kind === 'macro' &&
        !PICKER_ICON_NAMES.some((name) => name === value.name)
      )
        return [];
      return [value];
    })
    .slice(0, 9);
}

/** Picker preferences belong to the signed-in account, not the entity. */
export function createRecentIcons(userId: string) {
  const [icons, setIcons] = makePersisted(createSignal<AppearanceIcon[]>([]), {
    name: `entity-icons:recent:${userId}`,
    deserialize: readRecentIcons,
  });
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
