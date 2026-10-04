/**
 * The canvas UI drawn over the rendered page, in Figma's visual language:
 * frame names, hover outlines, selection boxes with their size, ⌥
 * measurements, the marquee, rulers, and the pixel grid.
 */

import type { FrameRow, NodeGeometry, Rect } from '@core/fig-engine/types';
import { type Camera, pageToScreen, type Size } from '../core/camera';
import { formatMeasure, type MeasureLine } from '../core/measure';
import { rulerStep, rulerTicks } from '../core/rulers';

export const SELECTION_BLUE = '#0d99ff';
export const COMPONENT_PURPLE = '#9747ff';
export const MEASURE_RED = '#f24822';
const RULER_SIZE = 20;

export interface OverlayModel {
  camera: Camera;
  viewport: Size;
  dpr: number;
  /** Top-level layers, for their name labels. */
  frames: FrameRow[];
  selectedIds: Set<string>;
  selection: NodeGeometry[];
  selectionBounds?: Rect;
  /** Selected or hovered layers inside components draw purple. */
  componentSelection: boolean;
  hoverPath?: Path2D;
  hoverComponent: boolean;
  /** Screen rectangle. */
  marquee?: Rect;
  measurements: MeasureLine[];
  rulers: boolean;
  pixelGrid: boolean;
  /** Whether the canvas color is dark (labels switch to light). */
  darkCanvas: boolean;
}

const LABEL_TYPES = new Set(['FRAME', 'SYMBOL', 'SECTION', 'INSTANCE']);

function pill(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string
) {
  ctx.font = '500 11px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 8;
  const h = 16;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(Math.round(x - w / 2), Math.round(y), w, h, 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, Math.round(x), Math.round(y + h / 2) + 0.5);
}

function drawPixelGrid(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  const { camera, viewport } = m;
  if (!m.pixelGrid || camera.zoom < 8) return;
  ctx.strokeStyle = m.darkCanvas
    ? 'rgba(255,255,255,0.08)'
    : 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const x0 = Math.floor(camera.x);
  const y0 = Math.floor(camera.y);
  for (let x = x0; x <= camera.x + viewport.w / camera.zoom; x++) {
    const sx = Math.round((x - camera.x) * camera.zoom) + 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, viewport.h);
  }
  for (let y = y0; y <= camera.y + viewport.h / camera.zoom; y++) {
    const sy = Math.round((y - camera.y) * camera.zoom) + 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(viewport.w, sy);
  }
  ctx.stroke();
}

function drawFrameLabels(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  for (const f of m.frames) {
    if (!LABEL_TYPES.has(f.type)) continue;
    const p = pageToScreen(m.camera, f.bounds);
    const width = f.bounds.w * m.camera.zoom;
    if (width < 24) continue;
    if (p.x > m.viewport.w || p.x + width < 0 || p.y < -4) continue;
    if (p.y > m.viewport.h + 20) continue;
    const selected = m.selectedIds.has(f.id);
    ctx.fillStyle = selected
      ? f.type === 'SYMBOL'
        ? COMPONENT_PURPLE
        : SELECTION_BLUE
      : m.darkCanvas
        ? 'rgba(255,255,255,0.55)'
        : 'rgba(0,0,0,0.5)';
    let name = f.name;
    // Truncate to the frame's width, as Figma does.
    while (name.length > 1 && ctx.measureText(name).width > width) {
      name = `${name.slice(0, -2)}…`;
    }
    ctx.fillText(name, Math.round(p.x), Math.round(p.y - 4));
  }
}

function drawSelection(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  const color = m.componentSelection ? COMPONENT_PURPLE : SELECTION_BLUE;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const g of m.selection) {
    ctx.beginPath();
    g.corners.forEach((c, i) => {
      const p = pageToScreen(m.camera, c);
      if (i === 0) ctx.moveTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5);
      else ctx.lineTo(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5);
    });
    ctx.closePath();
    ctx.stroke();
  }
  const b = m.selectionBounds;
  if (!b) return;
  const tl = pageToScreen(m.camera, b);
  const w = b.w * m.camera.zoom;
  const h = b.h * m.camera.zoom;
  if (m.selection.length > 1) {
    ctx.strokeRect(
      Math.round(tl.x) + 0.5,
      Math.round(tl.y) + 0.5,
      Math.round(w),
      Math.round(h)
    );
  }
  // Corner handles, as Figma draws them (read-only: they do not resize).
  ctx.fillStyle = '#ffffff';
  for (const [x, y] of [
    [tl.x, tl.y],
    [tl.x + w, tl.y],
    [tl.x, tl.y + h],
    [tl.x + w, tl.y + h],
  ]) {
    ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 7, 7);
    ctx.strokeRect(Math.round(x) - 2.5, Math.round(y) - 2.5, 6, 6);
  }
  pill(
    ctx,
    `${formatMeasure(b.w)} × ${formatMeasure(b.h)}`,
    tl.x + w / 2,
    tl.y + h + 8,
    color
  );
}

function drawHover(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  if (!m.hoverPath) return;
  const { camera, dpr } = m;
  ctx.save();
  ctx.setTransform(
    camera.zoom * dpr,
    0,
    0,
    camera.zoom * dpr,
    -camera.x * camera.zoom * dpr,
    -camera.y * camera.zoom * dpr
  );
  ctx.strokeStyle = m.hoverComponent ? COMPONENT_PURPLE : SELECTION_BLUE;
  ctx.lineWidth = 2 / camera.zoom;
  ctx.stroke(m.hoverPath);
  ctx.restore();
}

function drawMeasurements(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  ctx.strokeStyle = MEASURE_RED;
  ctx.lineWidth = 1;
  for (const line of m.measurements) {
    const a = pageToScreen(m.camera, line.from);
    const b = pageToScreen(m.camera, line.to);
    ctx.beginPath();
    ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
    ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
    ctx.stroke();
    pill(
      ctx,
      formatMeasure(line.value),
      (a.x + b.x) / 2,
      (a.y + b.y) / 2 - 8,
      MEASURE_RED
    );
  }
}

function drawMarquee(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  const r = m.marquee;
  if (!r) return;
  ctx.fillStyle = 'rgba(13,153,255,0.08)';
  ctx.strokeStyle = SELECTION_BLUE;
  ctx.lineWidth = 1;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeRect(
    Math.round(r.x) + 0.5,
    Math.round(r.y) + 0.5,
    Math.round(r.w),
    Math.round(r.h)
  );
}

function drawRulers(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  if (!m.rulers) return;
  const { camera, viewport } = m;
  const bg = m.darkCanvas ? '#2c2c2c' : '#ffffff';
  const ink = m.darkCanvas ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, viewport.w, RULER_SIZE);
  ctx.fillRect(0, 0, RULER_SIZE, viewport.h);
  ctx.strokeStyle = m.darkCanvas
    ? 'rgba(255,255,255,0.15)'
    : 'rgba(0,0,0,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, RULER_SIZE - 0.5);
  ctx.lineTo(viewport.w, RULER_SIZE - 0.5);
  ctx.moveTo(RULER_SIZE - 0.5, 0);
  ctx.lineTo(RULER_SIZE - 0.5, viewport.h);
  ctx.stroke();
  // The selection's extent, shaded on both rulers.
  const b = m.selectionBounds;
  if (b) {
    const tl = pageToScreen(camera, b);
    ctx.fillStyle = 'rgba(13,153,255,0.15)';
    ctx.fillRect(tl.x, 0, b.w * camera.zoom, RULER_SIZE);
    ctx.fillRect(0, tl.y, RULER_SIZE, b.h * camera.zoom);
  }
  const step = rulerStep(camera.zoom);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.font = '9px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.beginPath();
  for (const t of rulerTicks(camera.x, viewport.w / camera.zoom, step)) {
    const x = Math.round((t - camera.x) * camera.zoom) + 0.5;
    if (x < RULER_SIZE) continue;
    ctx.moveTo(x, RULER_SIZE - 6);
    ctx.lineTo(x, RULER_SIZE);
    ctx.fillText(String(t), x + 2, 3);
  }
  ctx.stroke();
  ctx.beginPath();
  for (const t of rulerTicks(camera.y, viewport.h / camera.zoom, step)) {
    const y = Math.round((t - camera.y) * camera.zoom) + 0.5;
    if (y < RULER_SIZE) continue;
    ctx.moveTo(RULER_SIZE - 6, y);
    ctx.lineTo(RULER_SIZE, y);
    ctx.save();
    ctx.translate(3, y - 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(String(t), 0, 0);
    ctx.restore();
  }
  ctx.stroke();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, RULER_SIZE, RULER_SIZE);
}

/** Draws the overlay; the context is in device pixels. */
export function drawOverlay(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  drawPixelGrid(ctx, m);
  drawFrameLabels(ctx, m);
  drawHover(ctx, m);
  drawSelection(ctx, m);
  drawMeasurements(ctx, m);
  drawMarquee(ctx, m);
  drawRulers(ctx, m);
}
