/**
 * Sections in the slide rail and sorter: where each section's header row
 * goes among the thumbnails, which thumbnails collapsed sections hide, and
 * where Move Section Up/Down takes a section.
 */

import type { SectionOutline } from '@core/pptx-engine/types';

/** The name PowerPoint gives a new section. */
export const NEW_SECTION_NAME = 'Untitled Section';

export interface SectionRow {
  section: SectionOutline;
  /** Position among the sections. */
  index: number;
  /**
   * Deck index of the slide the header goes before; the slide count for an
   * empty section after the last slide.
   */
  before: number;
}

/**
 * Header rows in deck order. An empty section's header follows the previous
 * section's slides.
 */
export function sectionRows(
  sections: readonly SectionOutline[] | undefined,
  slideIds: readonly number[]
): SectionRow[] {
  if (!sections) return [];
  const position = new Map(slideIds.map((id, i) => [id, i]));
  let next = 0;
  return sections.map((section, index) => {
    const at = section.slideIds
      .map((id) => position.get(id))
      .filter((i): i is number => i !== undefined);
    const before = at.length > 0 ? Math.min(...at) : next;
    if (at.length > 0) next = Math.max(...at) + 1;
    return { section, index, before };
  });
}

/** The section a slide is in. */
export function sectionOf(
  sections: readonly SectionOutline[] | undefined,
  slideId: number | undefined
): SectionOutline | undefined {
  if (slideId === undefined) return undefined;
  return sections?.find((s) => s.slideIds.includes(slideId));
}

/** Slides whose thumbnails collapsed sections hide. */
export function hiddenSlides(
  sections: readonly SectionOutline[] | undefined,
  collapsed: ReadonlySet<string>
): Set<number> {
  const out = new Set<number>();
  for (const s of sections ?? [])
    if (collapsed.has(s.id)) for (const id of s.slideIds) out.add(id);
  return out;
}

/**
 * The index Move Section Up (`-1`) or Down (`1`) gives a section; undefined
 * when it is already first or last.
 */
export function moveTarget(
  sections: readonly SectionOutline[] | undefined,
  id: string,
  delta: -1 | 1
): number | undefined {
  const list = sections ?? [];
  const from = list.findIndex((s) => s.id === id);
  const to = from + delta;
  return from < 0 || to < 0 || to >= list.length ? undefined : to;
}

/** Whether `ids` is exactly the slides of `section` (the section is selected). */
export function isSectionSelected(
  section: SectionOutline,
  ids: readonly number[]
): boolean {
  return (
    section.slideIds.length > 0 &&
    section.slideIds.length === ids.length &&
    section.slideIds.every((id) => ids.includes(id))
  );
}
