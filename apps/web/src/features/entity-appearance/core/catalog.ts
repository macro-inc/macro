import { ICON_SECTIONS } from './catalog.generated';

export { ICON_SECTIONS };

export type PickerIconName =
  (typeof ICON_SECTIONS)[number]['icons'][number]['name'];

const PICKER_ICONS = ICON_SECTIONS.flatMap((section) => [...section.icons]);

export const PICKER_ICON_NAMES = PICKER_ICONS.map(({ name }) => name);
export const PICKER_ICON_LABELS = new Map<string, string>(
  PICKER_ICONS.map(({ name, label }) => [name, label])
);

export function isPickerIconName(name: string): name is PickerIconName {
  return PICKER_ICON_LABELS.has(name);
}

export function iconLabel(name: string): string {
  const label = name.replaceAll('-', ' ');
  return label.charAt(0).toUpperCase() + label.slice(1);
}
