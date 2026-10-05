/**
 * The canvas UI drawn over the rendered artwork, in Illustrator's visual
 * language: artboard edges and names, highlights in the layer's color,
 * the selection's bounding box and handles, anchor points and handles of
 * the path being edited, the pen's path, shapes being drawn, marquees,
 * and other people's selections.
 */

import {
  type Camera,
  pageToScreen,
  type Size,
} from '@app/features/block-fig/core/camera';
import { HANDLES, handlePoint, type Point, type Rect } from '../core/geometry';
import type { Anchor, PathData } from '../core/path';
import type { PeerOverlay } from '../core/presence';

/** Illustrator's selection blue (Layer 1's color). */
export const SELECTION_COLOR = '#4f80ff';

/** An object's outline as the overlay draws it. */
export interface OverlayShape {
  /** Its outline in canvas coordinates (else `rect`). */
  path?: PathData;
  rect?: Rect;
  color: string;
}

export interface OverlayArtboard {
  id: number;
  name: string;
  rect: Rect;
}

export interface OverlayModel {
  camera: Camera;
  viewport: Size;
  dpr: number;
  /** Whether the pasteboard is dark (edges and labels switch to light). */
  dark: boolean;
  artboards: OverlayArtboard[];
  /** The artboard chosen with the artboard tool, with its handles. */
  artboard?: number;
  hover?: OverlayShape;
  /** The selected objects' outlines. */
  selection: OverlayShape[];
  /** The selection's bounding box, with handles when it can be resized. */
  box?: { rect: Rect; color: string; handles: boolean };
  /** The points of the path being edited (canvas coordinates). */
  anchors?: { anchors: Anchor[]; selected?: number; color: string };
  /** A shape or line being drawn (canvas coordinates). */
  preview?: PathData;
  /** The pen's path so far, with the segment to the pointer. */
  pen?: { path: PathData; points: Point[]; closing: boolean };
  /** A selection or zoom marquee (screen coordinates). */
  marquee?: Rect;
  peers?: PeerOverlay[];
}

const HANDLE = 6;
const ANCHOR = 5;

const crisp = (v: number) => Math.round(v) + 0.5;

/** Starts a path for a `PathData` in canvas coordinates, mapped to the screen. */
function trace(ctx: CanvasRenderingContext2D, path: PathData, camera: Camera) {
  const s = (p: Point) => pageToScreen(camera, p);
  ctx.beginPath();
  for (const seg of path.segs) {
    switch (seg.type) {
      case 'move': {
        const p = s(seg.p);
        ctx.moveTo(p.x, p.y);
        break;
      }
      case 'line': {
        const p = s(seg.p);
        ctx.lineTo(p.x, p.y);
        break;
      }
      case 'cubic': {
        const a = s(seg.c1);
        const b = s(seg.c2);
        const p = s(seg.p);
        ctx.bezierCurveTo(a.x, a.y, b.x, b.y, p.x, p.y);
        break;
      }
      case 'close':
        ctx.closePath();
        break;
    }
  }
}

function screenRect(camera: Camera, r: Rect): Rect {
  const tl = pageToScreen(camera, r);
  return { x: tl.x, y: tl.y, w: r.w * camera.zoom, h: r.h * camera.zoom };
}

function strokeShape(
  ctx: CanvasRenderingContext2D,
  shape: OverlayShape,
  camera: Camera,
  width: number
) {
  ctx.strokeStyle = shape.color;
  ctx.lineWidth = width;
  if (shape.path) {
    trace(ctx, shape.path, camera);
    ctx.stroke();
  } else if (shape.rect) {
    const r = screenRect(camera, shape.rect);
    ctx.strokeRect(crisp(r.x), crisp(r.y), Math.round(r.w), Math.round(r.h));
  }
}

function drawHandles(ctx: CanvasRenderingContext2D, r: Rect, color: string) {
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  for (const h of HANDLES) {
    const p = handlePoint(r, h);
    const x = Math.round(p.x - HANDLE / 2);
    const y = Math.round(p.y - HANDLE / 2);
    ctx.fillRect(x, y, HANDLE, HANDLE);
    ctx.strokeRect(x + 0.5, y + 0.5, HANDLE - 1, HANDLE - 1);
  }
}

function drawArtboards(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  ctx.textAlign = 'left';
  m.artboards.forEach((a, index) => {
    const r = screenRect(m.camera, a.rect);
    const chosen = a.id === m.artboard;
    ctx.strokeStyle = chosen
      ? SELECTION_COLOR
      : m.dark
        ? 'rgba(255,255,255,0.35)'
        : 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(crisp(r.x), crisp(r.y), Math.round(r.w), Math.round(r.h));
    if (r.w >= 24 && r.y > -4 && r.y < m.viewport.h + 20) {
      ctx.fillStyle = chosen
        ? SELECTION_COLOR
        : m.dark
          ? 'rgba(255,255,255,0.6)'
          : 'rgba(0,0,0,0.55)';
      let label = `${String(index + 1).padStart(2, '0')} - ${a.name}`;
      while (label.length > 1 && ctx.measureText(label).width > r.w)
        label = `${label.slice(0, -2)}…`;
      ctx.fillText(label, Math.round(r.x), Math.round(r.y - 4));
    }
    if (chosen) drawHandles(ctx, r, SELECTION_COLOR);
  });
}

function drawSelection(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  for (const shape of m.selection) strokeShape(ctx, shape, m.camera, 1);
  if (!m.box) return;
  const r = screenRect(m.camera, m.box.rect);
  ctx.strokeStyle = m.box.color;
  ctx.lineWidth = 1;
  ctx.strokeRect(crisp(r.x), crisp(r.y), Math.round(r.w), Math.round(r.h));
  if (m.box.handles) drawHandles(ctx, r, m.box.color);
}

function drawAnchors(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  const a = m.anchors;
  if (!a) return;
  const s = (p: Point) => pageToScreen(m.camera, p);
  ctx.strokeStyle = a.color;
  ctx.lineWidth = 1;
  // The selected anchor's handles (Illustrator shows those of the point
  // and its neighbors' facing ones; the point's own are enough here).
  const chosen = a.selected === undefined ? undefined : a.anchors[a.selected];
  if (chosen) {
    const at = s(chosen.point);
    for (const h of [chosen.handleIn, chosen.handleOut]) {
      if (!h) continue;
      const q = s(h);
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
      ctx.lineTo(q.x, q.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = a.color;
      ctx.fill();
    }
  }
  a.anchors.forEach((anchor, i) => {
    const p = s(anchor.point);
    const x = Math.round(p.x - ANCHOR / 2);
    const y = Math.round(p.y - ANCHOR / 2);
    ctx.fillStyle = i === a.selected ? a.color : '#ffffff';
    ctx.fillRect(x, y, ANCHOR, ANCHOR);
    ctx.strokeRect(x + 0.5, y + 0.5, ANCHOR - 1, ANCHOR - 1);
  });
}

function drawPen(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  const pen = m.pen;
  if (!pen) return;
  ctx.strokeStyle = SELECTION_COLOR;
  ctx.lineWidth = 1;
  trace(ctx, pen.path, m.camera);
  ctx.stroke();
  pen.points.forEach((point, i) => {
    const p = pageToScreen(m.camera, point);
    const closing = i === 0 && pen.closing;
    const size = closing ? ANCHOR + 4 : ANCHOR;
    ctx.fillStyle = closing ? SELECTION_COLOR : '#ffffff';
    ctx.fillRect(
      Math.round(p.x - size / 2),
      Math.round(p.y - size / 2),
      size,
      size
    );
    ctx.strokeRect(
      Math.round(p.x - size / 2) + 0.5,
      Math.round(p.y - size / 2) + 0.5,
      size - 1,
      size - 1
    );
  });
}

function drawMarquee(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  if (m.preview) {
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1;
    trace(ctx, m.preview, m.camera);
    ctx.stroke();
  }
  const r = m.marquee;
  if (!r) return;
  ctx.fillStyle = 'rgba(79,128,255,0.08)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = m.dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)';
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(crisp(r.x), crisp(r.y), Math.round(r.w), Math.round(r.h));
  ctx.setLineDash([]);
}

/** What other people selected, outlined in their colors. */
function drawPeers(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  for (const peer of m.peers ?? []) {
    ctx.strokeStyle = peer.color;
    ctx.lineWidth = peer.editing ? 2 : 1.5;
    for (const rect of peer.selection) {
      const r = screenRect(m.camera, rect);
      ctx.strokeRect(crisp(r.x), crisp(r.y), Math.round(r.w), Math.round(r.h));
    }
  }
}

/** Draws the overlay; the context is in device pixels. */
export function drawOverlay(ctx: CanvasRenderingContext2D, m: OverlayModel) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  drawArtboards(ctx, m);
  drawPeers(ctx, m);
  if (m.hover) strokeShape(ctx, m.hover, m.camera, 2);
  drawSelection(ctx, m);
  drawAnchors(ctx, m);
  drawPen(ctx, m);
  drawMarquee(ctx, m);
}
