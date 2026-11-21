export const SIDEBAR_SECTION_DRAG_TYPE = 'sidebar-section';
export type SectionDropEdge = 'top' | 'bottom';

export function sectionDropEdge(
  keys: readonly string[],
  source: string,
  target: string
): SectionDropEdge | undefined {
  const from = keys.indexOf(source);
  const to = keys.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  return from < to ? 'bottom' : 'top';
}

export function reorderSection<Key extends string>(
  keys: readonly Key[],
  source: string,
  target: string
): Key[] | undefined {
  const values: readonly string[] = keys;
  const from = values.indexOf(source);
  const to = values.indexOf(target);
  if (from < 0 || to < 0 || from === to) return;
  const next = [...keys];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Preserve hidden slots, including keys not currently mounted in Chat. */
export function replaceVisibleSectionOrder<Key extends string>(
  order: readonly Key[],
  sections: readonly Key[]
): Key[] {
  const visible = new Set(sections);
  const all = [...new Set([...order, ...sections])];
  let index = 0;
  return all.map((key) => (visible.has(key) ? sections[index++] : key));
}

/** Saved known keys fill their old slots; new sections keep their default positions. */
export function mergeSectionOrder<Key extends string>(
  defaults: readonly Key[],
  saved: readonly string[]
): Key[] {
  const keys = [...new Set(defaults)];
  const ordered = [...new Set(saved)].flatMap((savedKey) =>
    keys.filter((key) => key === savedKey)
  );
  const known = new Set(ordered);
  let index = 0;
  return keys.map((key) => (known.has(key) ? ordered[index++] : key));
}
