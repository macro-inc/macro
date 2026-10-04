/**
 * Format painter: what PowerPoint's Format Painter copies from a shape or
 * from text, and the edit operations that paint it onto other shapes or
 * onto a text range.
 */

import type {
  CellRef,
  EditOp,
  ParagraphStyle,
  ParaPatch,
  RunPatch,
  RunStyle,
  TextPos,
} from '@core/pptx-engine/types';

export interface PainterSource {
  slide: number;
  shape: number;
  /** Paint the shape's look (fill, outline, effects); false for text. */
  look: boolean;
  /** Character formatting to paint, when the source has text. */
  run?: RunStyle;
  /** Paragraph formatting to paint with whole-shape painting. */
  paragraph?: ParagraphStyle;
}

/** The run of `paragraph` that formats the character at `offset`. */
export function runAt(
  paragraph: ParagraphStyle,
  offset: number
): RunStyle | undefined {
  return (
    paragraph.runs.find((r) => offset >= r.start && offset < r.end) ??
    paragraph.runs.findLast((r) => r.start < offset) ??
    paragraph.runs[0] ??
    paragraph.end
  );
}

/** Character formatting of a resolved run, as a patch. */
export function runPatchOf(run: RunStyle): RunPatch {
  return {
    bold: run.bold,
    italic: run.italic,
    underline: run.underline,
    strike: run.strike,
    size: run.size,
    font: run.font,
    baseline: run.baseline ?? 0,
    highlight: run.highlight?.replace('#', '') ?? '',
    ...(run.color ? { color: run.color.replace('#', '') } : {}),
  };
}

/** Paragraph formatting of a resolved paragraph, as a patch. */
export function paraPatchOf(paragraph: ParagraphStyle): ParaPatch {
  return { align: paragraph.align };
}

/** Operations that paint `source` onto whole shapes. */
export function paintShapesOps(
  source: PainterSource,
  slide: number,
  shapes: { id: number; textEditable: boolean }[]
): EditOp[] {
  const ops: EditOp[] = [];
  if (source.look && shapes.length > 0)
    ops.push({
      op: 'pasteFormat',
      slide,
      shapes: shapes.map((s) => s.id),
      fromSlide: source.slide,
      fromShape: source.shape,
    });
  for (const shape of shapes) {
    if (!shape.textEditable) continue;
    if (source.run)
      ops.push({
        op: 'formatText',
        slide,
        shape: shape.id,
        props: runPatchOf(source.run),
      });
    if (source.paragraph)
      ops.push({
        op: 'formatParagraphs',
        slide,
        shape: shape.id,
        props: paraPatchOf(source.paragraph),
      });
  }
  return ops;
}

/** Operations that paint `source`'s character formatting onto a range. */
export function paintRangeOps(
  source: PainterSource,
  target: {
    slide: number;
    shape: number;
    start: TextPos;
    end: TextPos;
    cell?: CellRef;
  }
): EditOp[] {
  if (!source.run) return [];
  return [
    {
      op: 'formatText',
      slide: target.slide,
      shape: target.shape,
      start: target.start,
      end: target.end,
      ...(target.cell ? { cell: target.cell } : {}),
      props: runPatchOf(source.run),
    },
  ];
}
