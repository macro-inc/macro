/**
 * Shaping a harness's model list for the pickers: the headings it grouped
 * models under, minus the ones that would only repeat a model's own name.
 */

import type { ModelOption } from '@service-agent-fold/generated/types';

/** Consecutive options under one harness heading (`null` = no heading). */
export type ModelGroup = { label: string | null; options: ModelOption[] };

/**
 * Drop a heading whose only member carries the same name — Cursor files
 * "Auto" under a family of its own, which would render as "Auto" twice.
 */
export function withoutRedundantGroups(options: ModelOption[]): ModelOption[] {
  const groupSizes = new Map<string, number>();
  for (const option of options) {
    if (option.group) {
      groupSizes.set(option.group, (groupSizes.get(option.group) ?? 0) + 1);
    }
  }
  return options.map((option) =>
    option.group &&
    option.group === option.name &&
    groupSizes.get(option.group) === 1
      ? { ...option, group: null }
      : option
  );
}

export function groupOptions(options: ModelOption[]): ModelGroup[] {
  const groups: ModelGroup[] = [];
  for (const option of options) {
    const label = option.group ?? null;
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.options.push(option);
    else groups.push({ label, options: [option] });
  }
  return groups;
}
