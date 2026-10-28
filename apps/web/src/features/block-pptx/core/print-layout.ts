/**
 * Print layouts, as PowerPoint's Print pane offers them: full page slides,
 * notes pages, and handouts. Geometry is in points on the page.
 */

import type { Rect } from './selection';

export type PrintLayout = 'slides' | 'notes' | 'handouts3' | 'handouts6';
export type Paper = 'letter' | 'a4';

export interface PageSpec {
  width: number;
  height: number;
  /** Where each slide on the page goes, in order. */
  slides: Rect[];
  /** Where the notes go (notes pages). */
  notes?: Rect;
  /** Ruled lines beside each slide (three-slide handouts). */
  lines?: Rect[];
  /** Where the page number goes, if any. */
  footer?: Rect;
}

const PAPER: Record<Paper, { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
};

/** The paper size a locale prints on by default. */
export function defaultPaper(locale: string): Paper {
  return /-(US|CA|MX|PH|CL|CO|VE)$/i.test(locale) || locale === 'en'
    ? 'letter'
    : 'a4';
}

export function slidesPerPage(layout: PrintLayout): number {
  return layout === 'handouts3' ? 3 : layout === 'handouts6' ? 6 : 1;
}

/** Fits a `w` × `h` box into `box`, centered. */
function fit(box: Rect, w: number, h: number): Rect {
  const s = Math.min(box.w / w, box.h / h);
  return {
    x: box.x + (box.w - w * s) / 2,
    y: box.y + (box.h - h * s) / 2,
    w: w * s,
    h: h * s,
  };
}

/** The page geometry for slides `slideW` × `slideH` points. */
export function pageSpec(
  layout: PrintLayout,
  slideW: number,
  slideH: number,
  paper: Paper
): PageSpec {
  if (layout === 'slides')
    return {
      width: slideW,
      height: slideH,
      slides: [{ x: 0, y: 0, w: slideW, h: slideH }],
    };
  const { width, height } = PAPER[paper];
  const margin = 54;
  const footer = { x: margin, y: height - 40, w: width - 2 * margin, h: 14 };
  if (layout === 'notes') {
    const slide = fit(
      { x: margin + 18, y: 54, w: width - 2 * (margin + 18), h: height * 0.4 },
      slideW,
      slideH
    );
    return {
      width,
      height,
      slides: [slide],
      notes: {
        x: margin,
        y: slide.y + slide.h + 30,
        w: width - 2 * margin,
        h: height - (slide.y + slide.h + 30) - 60,
      },
      footer,
    };
  }
  const top = 54;
  const usable = height - top - 60;
  if (layout === 'handouts3') {
    const cell = usable / 3;
    const slides: Rect[] = [];
    const lines: Rect[] = [];
    for (let i = 0; i < 3; i++) {
      const box = {
        x: margin,
        y: top + i * cell + 10,
        w: (width - 2 * margin) * 0.46,
        h: cell - 20,
      };
      const slide = fit(box, slideW, slideH);
      slides.push(slide);
      lines.push({
        x: margin + (width - 2 * margin) * 0.54,
        y: slide.y,
        w: (width - 2 * margin) * 0.46,
        h: slide.h,
      });
    }
    return { width, height, slides, lines, footer };
  }
  const gap = 18;
  const cw = (width - 2 * margin - gap) / 2;
  const ch = usable / 3;
  const slides: Rect[] = [];
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 2; col++)
      slides.push(
        fit(
          {
            x: margin + col * (cw + gap),
            y: top + row * ch + 8,
            w: cw,
            h: ch - 16,
          },
          slideW,
          slideH
        )
      );
  return { width, height, slides, footer };
}

/**
 * Slide indexes for a range like `1-3, 5` (1-based, in order, without
 * repeats); undefined when it does not parse or names no slide.
 */
export function parseSlideRange(
  text: string,
  count: number
): number[] | undefined {
  const out: number[] = [];
  for (const part of text.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(t);
    if (!m) return undefined;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a) return undefined;
    for (let n = a; n <= Math.min(b, count); n++)
      if (!out.includes(n - 1)) out.push(n - 1);
  }
  return out.length > 0 ? out : undefined;
}

/** Splits slide indexes into pages. */
export function paginate(indexes: number[], perPage: number): number[][] {
  const pages: number[][] = [];
  for (let i = 0; i < indexes.length; i += perPage)
    pages.push(indexes.slice(i, i + perPage));
  return pages;
}
