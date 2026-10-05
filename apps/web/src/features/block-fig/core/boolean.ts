/**
 * Figma's boolean operations, as the toolbar menu and the design panel
 * offer them. The names are the file format's (`XOR` is Exclude).
 */

export type BooleanOperation = 'UNION' | 'SUBTRACT' | 'INTERSECT' | 'XOR';

export interface BooleanItem {
  operation: BooleanOperation;
  label: string;
  /** The letter of its ⌥⇧ shortcut. */
  key: string;
  /** Test id suffix (`fig-boolean-<id>`). */
  id: 'union' | 'subtract' | 'intersect' | 'exclude';
}

export const BOOLEAN_ITEMS: readonly BooleanItem[] = [
  { operation: 'UNION', label: 'Union', key: 'U', id: 'union' },
  { operation: 'SUBTRACT', label: 'Subtract', key: 'S', id: 'subtract' },
  { operation: 'INTERSECT', label: 'Intersect', key: 'I', id: 'intersect' },
  { operation: 'XOR', label: 'Exclude', key: 'X', id: 'exclude' },
];

/** The menu item for a boolean layer's operation (Union when unset). */
export function booleanItem(operation: string | null | undefined): BooleanItem {
  return (
    BOOLEAN_ITEMS.find((b) => b.operation === operation) ?? BOOLEAN_ITEMS[0]
  );
}
