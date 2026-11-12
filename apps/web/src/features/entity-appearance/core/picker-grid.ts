import type { EntityAppearance } from './appearance';

export type PickerOption = {
  key: string;
  icon: NonNullable<EntityAppearance['icon']>;
  label: string;
};
export type PickerSection = {
  key: string;
  label: string;
  options: readonly PickerOption[];
};
export type PickerRow =
  | { kind: 'heading'; key: string; section: string; label: string }
  | {
      kind: 'options';
      key: string;
      section: string;
      options: readonly PickerOption[];
    };

export function pickerRows(
  sections: readonly PickerSection[],
  columns: number
): PickerRow[] {
  return sections.flatMap((section) => {
    if (section.options.length === 0) return [];
    const rows: PickerRow[] = [
      {
        kind: 'heading',
        key: `${section.key}:heading`,
        section: section.key,
        label: section.label,
      },
    ];
    for (let index = 0; index < section.options.length; index += columns) {
      rows.push({
        kind: 'options',
        key: `${section.key}:${index / columns}`,
        section: section.key,
        options: section.options.slice(index, index + columns),
      });
    }
    return rows;
  });
}

/** Logical navigation includes rows that are not mounted in the virtual viewport. */
export function nextPickerOption(
  rows: readonly PickerRow[],
  current: string | undefined,
  key: string
): PickerOption | undefined {
  const grids = rows.filter((row) => row.kind === 'options');
  const options = grids.flatMap((row) => row.options);
  if (options.length === 0) return;
  const index = options.findIndex((option) => option.key === current);
  const backward = key === 'ArrowLeft' || key === 'ArrowUp';
  if (index < 0) return backward ? options.at(-1) : options[0];
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    return options[
      Math.max(0, Math.min(options.length - 1, index + (backward ? -1 : 1)))
    ];
  }
  const rowIndex = grids.findIndex((row) =>
    row.options.some((option) => option.key === current)
  );
  const row = grids[rowIndex];
  const column = row.options.findIndex((option) => option.key === current);
  const next = grids[rowIndex + (backward ? -1 : 1)];
  return (
    next?.options[Math.min(column, next.options.length - 1)] ?? options[index]
  );
}
