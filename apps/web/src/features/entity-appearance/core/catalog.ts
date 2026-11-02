import { type ENTITY_ICON_NAMES, ICON_SECTIONS } from './catalog.generated';

export { ICON_SECTIONS };

type IconName = (typeof ENTITY_ICON_NAMES)[number];

export const PICKER_ICON_NAMES: readonly IconName[] = ICON_SECTIONS.flatMap(
  (section) => [...section.names]
);

export function iconLabel(name: string): string {
  const label = name.replaceAll('-', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
