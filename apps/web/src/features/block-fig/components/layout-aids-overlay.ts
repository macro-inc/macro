/**
 * Layout aids drawn over the canvas (never into exports): frames' layout
 * grids, ruler guides on the page and in frames, and Dev Mode's padding
 * and gap shading for auto layout frames.
 */

import type { FrameAids, LayoutAids } from '@core/fig-engine/handoff-types';
import { type Camera, pageToScreen, type Size } from '../core/camera';
import { gridShapes } from '../core/layout-grid';
import { formatMeasure } from '../core/measure';
import type { SpacingRegion } from '../core/spacing';

/** Figma's guide color. */
export const GUIDE_COLOR = '#f2487a';
const SPACING_FILL = 'rgba(242, 72, 122, 0.16)';
const SPACING_INK = '#d42a63';

/** A guide being dragged, in page coordinates. */
export interface DraggedGuide {
  axis: 'X' | 'Y';
  at: number;
  /** Dropping it now deletes it (it is over its ruler). */
  deleting: boolean;
  /** The frame it belongs to (its extent), if not the page. */
  frame?:
    | FrameAids
    | { transform: FrameAids['transform']; width: number; height: number };
}

export interface LayoutAidsModel {
  aids?: LayoutAids;
  grids: boolean;
  guides: boolean;
  dragged?: DraggedGuide;
  spacing?: SpacingRegion[];
}

interface View {
  camera: Camera;
  viewport: Size;
  dpr: number;
}

const hex = (color: string, alpha: number) => {
  const n = Number.parseInt(color, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

/** Frames' visible layout grids, clipped to their frames. */
export function drawLayoutGrids(
  ctx: CanvasRenderingContext2D,
  v: View,
  m: LayoutAidsModel
) {
  if (!m.grids || !m.aids) return;
  const { camera, dpr } = v;
  for (const f of m.aids.frames) {
    const visible = f.grids.filter((g) => g.visible);
    if (visible.length === 0) continue;
    const [a, b, c, d, e, g] = f.transform;
    const z = camera.zoom * dpr;
    ctx.save();
    ctx.setTransform(
      a * z,
      b * z,
      c * z,
      d * z,
      (e - camera.x) * z,
      (g - camera.y) * z
    );
    ctx.beginPath();
    ctx.rect(0, 0, f.width, f.height);
    ctx.clip();
    const scale = Math.hypot(a, b) * camera.zoom;
    for (const grid of visible) {
      if (grid.pattern === 'GRID' && grid.sectionSize * scale < 4) continue;
      const shapes = gridShapes(grid, f.width, f.height);
      ctx.fillStyle = hex(grid.color, grid.alpha);
      for (const band of shapes.bands)
        ctx.fillRect(band.x, band.y, band.w, band.h);
      if (shapes.xs.length || shapes.ys.length) {
        ctx.strokeStyle = hex(grid.color, Math.min(1, grid.alpha * 2));
        ctx.lineWidth = 1 / (scale * dpr);
        ctx.beginPath();
        for (const x of shapes.xs) {
          ctx.moveTo(x, 0);
          ctx.lineTo(x, f.height);
        }
        for (const y of shapes.ys) {
          ctx.moveTo(0, y);
          ctx.lineTo(f.width, y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

/** One guide on screen: across the view, or across its frame. */
function guideLine(
  ctx: CanvasRenderingContext2D,
  v: View,
  axis: 'X' | 'Y',
  at: number,
  frame?: { transform: FrameAids['transform']; width: number; height: number }
) {
  if (frame) {
    const [a, , , d, e, g] = frame.transform;
    if (axis === 'X') {
      const x = e + a * at;
      const p = pageToScreen(v.camera, { x, y: g });
      const q = pageToScreen(v.camera, { x, y: g + d * frame.height });
      const sx = Math.round(p.x) + 0.5;
      ctx.moveTo(sx, p.y);
      ctx.lineTo(sx, q.y);
    } else {
      const y = g + d * at;
      const p = pageToScreen(v.camera, { x: e, y });
      const q = pageToScreen(v.camera, { x: e + a * frame.width, y });
      const sy = Math.round(p.y) + 0.5;
      ctx.moveTo(p.x, sy);
      ctx.lineTo(q.x, sy);
    }
    return;
  }
  if (axis === 'X') {
    const sx = Math.round(pageToScreen(v.camera, { x: at, y: 0 }).x) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, v.viewport.h);
  } else {
    const sy = Math.round(pageToScreen(v.camera, { x: 0, y: at }).y) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(v.viewport.w, sy);
  }
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string
) {
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 8;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(Math.round(x - w / 2), Math.round(y - 8), w, 16, 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, Math.round(x), Math.round(y) + 0.5);
}

/** Ruler guides of the page and its frames, and one being dragged. */
export function drawRulerGuides(
  ctx: CanvasRenderingContext2D,
  v: View,
  m: LayoutAidsModel
) {
  if (!m.guides) return;
  ctx.save();
  ctx.strokeStyle = GUIDE_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const g of m.aids?.guides ?? []) guideLine(ctx, v, g.axis, g.offset);
  for (const f of m.aids?.frames ?? [])
    for (const g of f.guides) guideLine(ctx, v, g.axis, g.offset, f);
  ctx.stroke();
  const drag = m.dragged;
  if (drag) {
    ctx.globalAlpha = drag.deleting ? 0.4 : 1;
    ctx.beginPath();
    const local = drag.frame
      ? drag.axis === 'X'
        ? (drag.at - drag.frame.transform[4]) / drag.frame.transform[0]
        : (drag.at - drag.frame.transform[5]) / drag.frame.transform[3]
      : drag.at;
    guideLine(ctx, v, drag.axis, local, drag.frame);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const p = pageToScreen(v.camera, { x: drag.at, y: drag.at });
    const value = formatMeasure(Math.round(local * 100) / 100);
    if (drag.axis === 'X') label(ctx, value, p.x, 32, GUIDE_COLOR);
    else label(ctx, value, 40, p.y, GUIDE_COLOR);
  }
  ctx.restore();
}

/** Padding and gaps of an auto layout frame, shaded with their sizes. */
export function drawSpacing(
  ctx: CanvasRenderingContext2D,
  v: View,
  m: LayoutAidsModel
) {
  if (!m.spacing?.length) return;
  ctx.save();
  for (const r of m.spacing) {
    const a = pageToScreen(v.camera, r.rect);
    const w = r.rect.w * v.camera.zoom;
    const h = r.rect.h * v.camera.zoom;
    ctx.fillStyle = SPACING_FILL;
    ctx.fillRect(a.x, a.y, w, h);
    if (r.kind === 'gap') {
      ctx.strokeStyle = SPACING_INK;
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(
        Math.round(a.x) + 0.5,
        Math.round(a.y) + 0.5,
        Math.round(w),
        Math.round(h)
      );
      ctx.setLineDash([]);
    }
  }
  for (const r of m.spacing) {
    const c = pageToScreen(v.camera, {
      x: r.rect.x + r.rect.w / 2,
      y: r.rect.y + r.rect.h / 2,
    });
    if (r.rect.w * v.camera.zoom < 4 && r.rect.h * v.camera.zoom < 4) continue;
    label(ctx, formatMeasure(r.value), c.x, c.y, SPACING_INK);
  }
  ctx.restore();
}
