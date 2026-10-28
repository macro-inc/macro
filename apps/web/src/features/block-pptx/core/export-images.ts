/**
 * Export ▸ slides as pictures (PowerPoint's PNG and JPEG file types): which
 * slides, at what size, under which names.
 */

export type ImageFormat = 'png' | 'jpeg';
export type ExportScope = 'current' | 'selected' | 'all';

/** Widths offered, in pixels. */
export const EXPORT_WIDTHS = [
  { value: 1280, label: 'HD (1280 px wide)' },
  { value: 1920, label: 'Full HD (1920 px wide)' },
  { value: 3840, label: '4K (3840 px wide)' },
];

/** The slide indexes `scope` names, in deck order. */
export function exportIndexes(
  scope: ExportScope,
  current: number,
  selected: number[],
  total: number
): number[] {
  if (scope === 'all') return Array.from({ length: total }, (_, i) => i);
  if (scope === 'selected' && selected.length > 0)
    return [...new Set(selected)]
      .filter((i) => i >= 0 && i < total)
      .sort((a, b) => a - b);
  return current >= 0 && current < total ? [current] : [];
}

/** The deck's name without its extension, safe for file names. */
export function baseName(fileName: string): string {
  const stem = fileName.replace(/\.(pptx|ppt|potx|ppsx)$/i, '').trim();
  return stem.replace(/[\\/:*?"<>|]+/g, '-') || 'Presentation';
}

/** PowerPoint's names: `Slide3.png` inside `<deck>.zip`, or `<deck> - Slide3.png` alone. */
export function slideFileName(
  deck: string,
  index: number,
  format: ImageFormat,
  alone: boolean
): string {
  const ext = format === 'png' ? 'png' : 'jpg';
  return alone
    ? `${baseName(deck)} - Slide${index + 1}.${ext}`
    : `Slide${index + 1}.${ext}`;
}

/** The pixel box of a shape's bounds on a render `scale` px per point. */
export function cropBox(
  bounds: { x: number; y: number; w: number; h: number },
  scale: number,
  limit: { w: number; h: number }
) {
  const x = Math.max(0, Math.floor(bounds.x * scale));
  const y = Math.max(0, Math.floor(bounds.y * scale));
  const right = Math.min(limit.w, Math.ceil((bounds.x + bounds.w) * scale));
  const bottom = Math.min(limit.h, Math.ceil((bounds.y + bounds.h) * scale));
  return { x, y, w: Math.max(1, right - x), h: Math.max(1, bottom - y) };
}
