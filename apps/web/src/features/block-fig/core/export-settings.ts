/**
 * Export presets as Figma's Export section edits them: the size field
 * (`1x`, `0.5x`, `512w`, `300h`), what "+" adds, and the file names the
 * engine gives the files (`fig_engine::export::file_name`).
 */

import type {
  ExportFormat,
  ExportSetting,
} from '@core/fig-engine/handoff-types';
import { match } from 'ts-pattern';

/** The formats the format menu offers, as Figma labels them. */
export const EXPORT_FORMATS: { format: ExportFormat; label: string }[] = [
  { format: 'PNG', label: 'PNG' },
  { format: 'JPEG', label: 'JPEG' },
  { format: 'SVG', label: 'SVG' },
  { format: 'PDF', label: 'PDF' },
];

/** The sizes the size menu offers. */
export const EXPORT_SIZES = [
  '0.5x',
  '0.75x',
  '1x',
  '1.5x',
  '2x',
  '3x',
  '4x',
  '512w',
  '512h',
];

const round2 = (v: number) => Math.round(v * 100) / 100;

/** Figma's preset for `format` at 1x. */
export function defaultSetting(
  format: ExportFormat = 'PNG',
  value = 1
): ExportSetting {
  return {
    format,
    suffix: '',
    constraint: 'CONTENT_SCALE',
    value,
    svgOutlineText: true,
    svgIncludeId: false,
    contentsOnly: true,
    useAbsoluteBounds: false,
    quality: 90,
  };
}

/**
 * What "+" adds: 1x PNG first, then the next scale up from the last
 * preset in the same format (as Figma does), up to 4x.
 */
export function nextSetting(existing: readonly ExportSetting[]): ExportSetting {
  const last = existing.at(-1);
  if (!last) return defaultSetting();
  if (last.constraint !== 'CONTENT_SCALE')
    return { ...last, constraint: 'CONTENT_SCALE', value: 1, suffix: '' };
  const used = new Set(
    existing
      .filter(
        (s) => s.format === last.format && s.constraint === 'CONTENT_SCALE'
      )
      .map((s) => s.value)
  );
  let value = Math.max(1, Math.floor(last.value) + 1);
  while (used.has(value) && value < 4) value++;
  return { ...last, value: Math.min(value, 4), suffix: '' };
}

/** The size field's text for a preset. */
export function sizeLabel(s: ExportSetting): string {
  return match(s.constraint)
    .with('CONTENT_SCALE', () => `${round2(s.value)}x`)
    .with('CONTENT_WIDTH', () => `${Math.round(s.value)}w`)
    .with('CONTENT_HEIGHT', () => `${Math.round(s.value)}h`)
    .exhaustive();
}

/**
 * Parses the size field: `2`, `2x`, `0.5X`, `512w`, `300 h`. Returns
 * `undefined` for anything else.
 */
export function parseSize(
  text: string
): Pick<ExportSetting, 'constraint' | 'value'> | undefined {
  const m = /^\s*(\d*\.?\d+)\s*([xwh]?)\s*$/i.exec(text);
  if (!m) return undefined;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = m[2].toLowerCase();
  if (unit === 'w')
    return { constraint: 'CONTENT_WIDTH', value: Math.round(value) };
  if (unit === 'h')
    return { constraint: 'CONTENT_HEIGHT', value: Math.round(value) };
  return { constraint: 'CONTENT_SCALE', value: Math.min(round2(value), 64) };
}

/** Whether the size field applies to `format` (vectors export at 1x). */
export function hasSize(format: ExportFormat): boolean {
  return format === 'PNG' || format === 'JPEG';
}

const EXTENSIONS: Record<ExportFormat, string> = {
  PNG: 'png',
  JPEG: 'jpg',
  SVG: 'svg',
  PDF: 'pdf',
};

/** The suffix a preset appends: its own, or `@2x` for scaled images. */
export function effectiveSuffix(s: ExportSetting): string {
  if (s.suffix) return s.suffix;
  if (!hasSize(s.format)) return '';
  return match(s.constraint)
    .with('CONTENT_SCALE', () =>
      Math.abs(s.value - 1) > 1e-6 ? `@${round2(s.value)}x` : ''
    )
    .with('CONTENT_WIDTH', () => `@${Math.round(s.value)}w`)
    .with('CONTENT_HEIGHT', () => `@${Math.round(s.value)}h`)
    .exhaustive();
}

/** The file a preset makes of a layer named `layer`. */
export function exportFileName(layer: string, s: ExportSetting): string {
  const safe =
    layer
      .split('/')
      .map((p) => p.replace(/[\\:*?"<>|]/g, '-').trim())
      .filter((p) => p && p !== '.' && p !== '..')
      .join('/') || 'Untitled';
  return `${safe}${effectiveSuffix(s)}.${EXTENSIONS[s.format]}`;
}

/** The pixel size an image preset makes of a `width × height` layer. */
export function exportPixelSize(
  s: ExportSetting,
  width: number,
  height: number
): { w: number; h: number } {
  const scale = match(s.constraint)
    .with('CONTENT_SCALE', () => s.value)
    .with('CONTENT_WIDTH', () => (width > 0 ? s.value / width : 1))
    .with('CONTENT_HEIGHT', () => (height > 0 ? s.value / height : 1))
    .exhaustive();
  return {
    w: Math.max(1, Math.ceil(width * scale)),
    h: Math.max(1, Math.ceil(height * scale)),
  };
}
