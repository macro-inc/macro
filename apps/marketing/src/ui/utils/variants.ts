import { cn } from './classname';

type VariantGroups = Record<string, Record<string, string>>;

type VariantSelection<Groups extends VariantGroups> = {
  -readonly [Group in keyof Groups]?: Extract<keyof Groups[Group], string>;
};

/** Extracts the inferred variant selections accepted by a variant helper. */
export type VariantProps<VariantHelper> = VariantHelper extends (
  selection?: infer Selection
) => string
  ? NonNullable<Selection>
  : never;

/**
 * Creates a class helper from a base class and string-keyed variant groups.
 *
 * Variant names and values are inferred from `groups`. Classes are merged with
 * `cn`, so selected variants can override conflicting classes from the base.
 */
export function createVariants<const Groups extends VariantGroups>(
  base: string,
  groups: Groups,
  defaults: VariantSelection<Groups> = {}
): (selection?: VariantSelection<Groups>) => string {
  return (selection = {}) => {
    const selected = selection as Record<string, string | undefined>;
    const fallback = defaults as Record<string, string | undefined>;

    return cn(
      base,
      Object.entries(groups).map(([group, values]) => {
        const value = selected[group] ?? fallback[group];
        return value === undefined ? undefined : values[value];
      })
    );
  };
}
