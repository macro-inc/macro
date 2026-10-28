/**
 * Slide Master view (View ▸ Slide Master): the deck's slide masters and
 * their layouts listed as pages, each master followed by its layouts, and
 * what PowerPoint's Slide Master tab says and allows for each.
 */

import type {
  DeckOutline,
  MasterLayoutOutline,
  MasterOutline,
  PlaceholderKind,
  SlideOutline,
} from '@core/pptx-engine/types';

/** A master or one of its layouts. */
export interface MasterPage {
  id: number;
  master: MasterOutline;
  /** The layout, for a layout page. */
  layout?: MasterLayoutOutline;
}

/** Page ids in Slide Master view order: each master, then its layouts. */
export function masterPageIds(deck: DeckOutline): number[] {
  return (deck.masters ?? []).flatMap((m) => [
    m.id,
    ...m.layouts.map((l) => l.id),
  ]);
}

/** The master or layout with id `id`. */
export function findMasterPage(
  deck: DeckOutline,
  id: number
): MasterPage | undefined {
  for (const master of deck.masters ?? []) {
    if (master.id === id) return { id, master };
    const layout = master.layouts.find((l) => l.id === id);
    if (layout) return { id, master, layout };
  }
  return undefined;
}

/**
 * The deck as Slide Master view edits it: the masters and layouts (their
 * outlines, read by id) in place of the slides, positions renumbered.
 */
export function masterDeck(
  deck: DeckOutline,
  pages: SlideOutline[]
): DeckOutline {
  return {
    ...deck,
    slides: pages.map((page, index) => ({ ...page, index })),
    sections: undefined,
  };
}

/** Sorted 1-based numbers as PowerPoint lists them: `1, 3-5`. */
export function slideRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j === i ? String(sorted[i]) : `${sorted[i]}-${sorted[j]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

/** The ids of the slides a page is used by (a master: through any of its layouts). */
export function pageSlideIds(page: MasterPage): number[] {
  return page.layout
    ? page.layout.slideIds
    : page.master.layouts.flatMap((l) => l.slideIds);
}

/**
 * The tooltip PowerPoint shows on a page in Slide Master view: "Title Only
 * Layout: used by slide(s) 3-8", "Office Theme Slide Master: used by no
 * slides".
 */
export function pageTooltip(deck: DeckOutline, page: MasterPage): string {
  const name = page.layout
    ? `${page.layout.name} Layout`
    : `${page.master.name || 'Office Theme'} Slide Master`;
  const numbers = pageSlideIds(page)
    .map((id) => deck.slides.findIndex((s) => s.id === id) + 1)
    .filter((n) => n > 0);
  return numbers.length === 0
    ? `${name}: used by no slides`
    : `${name}: used by slide(s) ${slideRanges(numbers)}`;
}

/** Why a page cannot be deleted, or `undefined` when it can be. */
export function deleteBlocker(
  deck: DeckOutline,
  page: MasterPage
): string | undefined {
  if (pageSlideIds(page).length > 0)
    return page.layout
      ? 'Slides use this layout'
      : "Slides use this master's layouts";
  if (page.layout && page.master.layouts.length <= 1)
    return 'A slide master keeps at least one layout';
  if (!page.layout && (deck.masters?.length ?? 0) <= 1)
    return 'The presentation keeps at least one slide master';
  return undefined;
}

/** The state of a layout's Title and Footers checkboxes, from its outline. */
export function layoutOptions(page: SlideOutline | undefined): {
  title: boolean;
  footers: boolean;
} {
  const kinds = (page?.shapes ?? []).map((s) => s.placeholder);
  return {
    title: kinds.some((k) => k === 'title' || k === 'ctrTitle'),
    footers: kinds.some((k) => k === 'dt' || k === 'ftr' || k === 'sldNum'),
  };
}

/** PowerPoint's Insert Placeholder menu, in its order. */
export const PLACEHOLDER_CHOICES: {
  kind: PlaceholderKind;
  label: string;
  vertical?: boolean;
}[] = [
  { kind: 'content', label: 'Content' },
  { kind: 'content', label: 'Content (Vertical)', vertical: true },
  { kind: 'text', label: 'Text' },
  { kind: 'text', label: 'Text (Vertical)', vertical: true },
  { kind: 'picture', label: 'Picture' },
  { kind: 'chart', label: 'Chart' },
  { kind: 'table', label: 'Table' },
  { kind: 'smartArt', label: 'SmartArt' },
  { kind: 'media', label: 'Media' },
];

/**
 * Where an inserted placeholder goes: centered, a third of the slide wide
 * and tall (taller than wide for vertical text), offset a little from the
 * last one so several stay distinguishable.
 */
export function placeholderBox(
  slide: { w: number; h: number },
  vertical: boolean,
  count = 0
): { x: number; y: number; w: number; h: number } {
  const w = vertical ? slide.w / 5 : slide.w / 3;
  const h = vertical ? slide.h / 2 : slide.h / 3;
  const step = (count % 5) * 12;
  return {
    x: (slide.w - w) / 2 + step,
    y: (slide.h - h) / 2 + step,
    w,
    h,
  };
}

/**
 * A CSS preview of Background Styles style `style` (1-12): the column's
 * theme color (Light 1, Dark 1, Light 2, Dark 2) as the theme's first,
 * second, or third background fill usually draws it (solid, tinted, and
 * shaded to a gradient).
 */
export function backgroundStylePreview(
  themeColors: [string, string][],
  style: number
): string {
  const slot = ['lt1', 'dk1', 'lt2', 'dk2'][(style - 1) % 4];
  const color = themeColors.find(([s]) => s === slot)?.[1] ?? '#FFFFFF';
  const row = Math.floor((style - 1) / 4);
  if (row === 0) return color;
  if (row === 1) return `color-mix(in srgb, ${color} 85%, white)`;
  return `linear-gradient(to bottom, color-mix(in srgb, ${color} 70%, white), color-mix(in srgb, ${color} 80%, black))`;
}
