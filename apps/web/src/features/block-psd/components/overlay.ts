/**
 * The canvas overlay: the document's edge, the pixel grid at high zoom,
 * guides, this person's selection as marching ants, other people's
 * selections in their colors, and what the tool in use shows (marquees,
 * lassos, the gradient line, shapes, the crop box, Free Transform with the
 * layers drawn through it, the brush's footprint). Drawn on a 2D canvas in
 * device pixels.
 */

import type { Camera, Size } from '@app/features/block-fig/core/camera';
import type { Guide, IRect, SelectionInfo } from '@core/psd-engine/types';
import type { SharedSelection } from '../core/presence';
import type { DocSize } from '../core/tiles';
import type { ToolOverlay } from '../core/tool-overlay';
import {
  boxPoint,
  corners,
  HANDLE_SIDES,
  HANDLES,
  matrixOf,
} from '../core/transform';

export interface PeerSelection {
  color: string;
  selection: SharedSelection;
}

export interface OverlayModel {
  camera: Camera;
  viewport: Size;
  dpr: number;
  doc: DocSize;
  selection: SelectionInfo;
  /** Marching ants' dash offset. */
  antsPhase: number;
  tools: ToolOverlay;
  peers: PeerSelection[];
  guides: Guide[];
  pixelGrid: boolean;
  /** A CSS color for this person's accents (handles, boxes). */
  accent: string;
}

/** Zoom (device pixels per canvas pixel) from which the pixel grid shows. */
const GRID_FROM = 8;
const HANDLE_SIZE = 7;

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  model: OverlayModel
) {
  const { camera, dpr } = model;
  const s = camera.zoom * dpr;
  const X = (x: number) => (x - camera.x) * s;
  const Y = (y: number) => (y - camera.y) * s;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const docX0 = X(0);
  const docY0 = Y(0);
  const docX1 = X(model.doc.width);
  const docY1 = Y(model.doc.height);

  // Free Transform: the layers drawn through the box (they are hidden in
  // the composite meanwhile).
  const t = model.tools.transform;
  if (t) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(docX0, docY0, docX1 - docX0, docY1 - docY0);
    ctx.clip();
    const m = matrixOf(t.box);
    ctx.setTransform(s, 0, 0, s, -camera.x * s, -camera.y * s);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.imageSmoothingEnabled = true;
    for (const image of t.images) ctx.drawImage(image.image, image.x, image.y);
    ctx.restore();
  }

  // The document's edge.
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.strokeRect(
    Math.round(docX0) - 0.5,
    Math.round(docY0) - 0.5,
    Math.round(docX1 - docX0) + 1,
    Math.round(docY1 - docY0) + 1
  );

  if (model.pixelGrid && s >= GRID_FROM) drawPixelGrid(ctx, model, X, Y);

  // Guides.
  if (model.guides.length > 0) {
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const g of model.guides) {
      if (g.vertical) {
        const x = Math.round(X(g.position)) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, ctx.canvas.height);
      } else {
        const y = Math.round(Y(g.position)) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(ctx.canvas.width, y);
      }
    }
    ctx.stroke();
  }

  // Other people's selections, in their colors.
  for (const peer of model.peers) {
    ctx.beginPath();
    for (const flat of peer.selection.outline) {
      for (let i = 0; i + 1 < flat.length; i += 2) {
        const x = X(flat[i]);
        const y = Y(flat[i + 1]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = peer.color;
    ctx.fill('nonzero');
    ctx.restore();
    ctx.setLineDash([4 * dpr, 3 * dpr]);
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = peer.color;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // This person's selection: marching ants.
  if (model.selection.outline.length > 0) {
    ctx.beginPath();
    for (const polygon of model.selection.outline) {
      polygon.forEach(([px, py], i) => {
        const x = Math.round(X(px)) + 0.5;
        const y = Math.round(Y(py)) + 0.5;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ants(ctx, model.antsPhase, dpr);
  }

  const tools = model.tools;
  if (tools.marquee) {
    const r = tools.marquee.rect;
    ctx.beginPath();
    if (tools.marquee.kind === 'rect')
      ctx.rect(
        Math.round(X(r.x)) + 0.5,
        Math.round(Y(r.y)) + 0.5,
        r.w * s,
        r.h * s
      );
    else
      ctx.ellipse(
        X(r.x + r.w / 2),
        Y(r.y + r.h / 2),
        (r.w / 2) * s,
        (r.h / 2) * s,
        0,
        0,
        Math.PI * 2
      );
    ants(ctx, model.antsPhase, dpr);
  }

  if (tools.lasso && tools.lasso.points.length > 0) {
    ctx.beginPath();
    tools.lasso.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(X(p.x), Y(p.y));
      else ctx.lineTo(X(p.x), Y(p.y));
    });
    if (tools.lasso.cursor)
      ctx.lineTo(X(tools.lasso.cursor.x), Y(tools.lasso.cursor.y));
    ants(ctx, model.antsPhase, dpr);
    if (tools.lasso.closing) {
      const first = tools.lasso.points[0];
      ctx.beginPath();
      ctx.arc(X(first.x), Y(first.y), 5 * dpr, 0, Math.PI * 2);
      ctx.strokeStyle = model.accent;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }
  }

  if (tools.line) {
    const [a, b] = tools.line;
    ctx.beginPath();
    ctx.moveTo(X(a.x), Y(a.y));
    ctx.lineTo(X(b.x), Y(b.y));
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
    ctx.lineWidth = 1.25 * dpr;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.9)';
    ctx.stroke();
    for (const p of [a, b]) {
      ctx.beginPath();
      ctx.arc(X(p.x), Y(p.y), 3.5 * dpr, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.stroke();
    }
  }

  if (tools.shape) {
    const r = tools.shape.rect;
    ctx.beginPath();
    if (tools.shape.kind === 'rectangle')
      ctx.rect(X(r.x), Y(r.y), r.w * s, r.h * s);
    else
      ctx.ellipse(
        X(r.x + r.w / 2),
        Y(r.y + r.h / 2),
        (r.w / 2) * s,
        (r.h / 2) * s,
        0,
        0,
        Math.PI * 2
      );
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = model.accent;
    ctx.stroke();
  }

  if (tools.crop) drawCrop(ctx, tools.crop, model, X, Y);

  if (t) {
    const pts = corners(t.box).map((p) => [X(p.x), Y(p.y)] as const);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = model.accent;
    ctx.stroke();
    for (const handle of HANDLES) {
      const [hx, hy] = HANDLE_SIDES[handle];
      const p = boxPoint(t.box, hx, hy);
      drawHandle(ctx, X(p.x), Y(p.y), dpr, model.accent);
    }
    const c = boxPoint(t.box, 0, 0);
    ctx.beginPath();
    ctx.arc(X(c.x), Y(c.y), 3 * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = model.accent;
    ctx.stroke();
  }

  if (tools.brush) {
    const { at, size } = tools.brush;
    const r = Math.max(1, (size / 2) * s);
    const x = X(at.x);
    const y = Y(at.y);
    ctx.beginPath();
    if (r < 3 * dpr) {
      // Too small to see: a crosshair.
      ctx.moveTo(x - 5 * dpr, y);
      ctx.lineTo(x + 5 * dpr, y);
      ctx.moveTo(x, y - 5 * dpr);
      ctx.lineTo(x, y + 5 * dpr);
    } else ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.lineWidth = 2.5 * dpr;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.stroke();
    ctx.lineWidth = 1 * dpr;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.stroke();
  }
}

/** A white line under a moving black dash. */
function ants(ctx: CanvasRenderingContext2D, phase: number, dpr: number) {
  ctx.setLineDash([]);
  ctx.lineWidth = 1 * dpr;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.setLineDash([4 * dpr, 4 * dpr]);
  ctx.lineDashOffset = -phase * dpr;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dpr: number,
  accent: string
) {
  const h = HANDLE_SIZE * dpr;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1 * dpr;
  ctx.fillRect(Math.round(x - h / 2), Math.round(y - h / 2), h, h);
  ctx.strokeRect(
    Math.round(x - h / 2) + 0.5,
    Math.round(y - h / 2) + 0.5,
    h - 1,
    h - 1
  );
}

function drawCrop(
  ctx: CanvasRenderingContext2D,
  r: IRect,
  model: OverlayModel,
  X: (x: number) => number,
  Y: (y: number) => number
) {
  const { dpr } = model;
  const x0 = X(r.x);
  const y0 = Y(r.y);
  const x1 = X(r.x + r.w);
  const y1 = Y(r.y + r.h);
  // Darken what the crop leaves out.
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fill('evenodd');
  ctx.restore();
  // Rule of thirds.
  ctx.beginPath();
  for (const f of [1 / 3, 2 / 3]) {
    ctx.moveTo(x0 + (x1 - x0) * f, y0);
    ctx.lineTo(x0 + (x1 - x0) * f, y1);
    ctx.moveTo(x0, y0 + (y1 - y0) * f);
    ctx.lineTo(x1, y0 + (y1 - y0) * f);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.stroke();
  ctx.lineWidth = 1 * dpr;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  const box = {
    start: r,
    cx: r.x + r.w / 2,
    cy: r.y + r.h / 2,
    w: r.w,
    h: r.h,
    angle: 0,
  };
  for (const handle of HANDLES) {
    const [hx, hy] = HANDLE_SIDES[handle];
    const p = boxPoint(box, hx, hy);
    drawHandle(ctx, X(p.x), Y(p.y), dpr, model.accent);
  }
}

function drawPixelGrid(
  ctx: CanvasRenderingContext2D,
  model: OverlayModel,
  X: (x: number) => number,
  Y: (y: number) => number
) {
  const { camera, viewport, doc } = model;
  const x0 = Math.max(0, Math.floor(camera.x));
  const y0 = Math.max(0, Math.floor(camera.y));
  const x1 = Math.min(
    doc.width,
    Math.ceil(camera.x + viewport.w / camera.zoom)
  );
  const y1 = Math.min(
    doc.height,
    Math.ceil(camera.y + viewport.h / camera.zoom)
  );
  if (x1 <= x0 || y1 <= y0) return;
  ctx.beginPath();
  for (let x = x0; x <= x1; x++) {
    const sx = Math.round(X(x)) + 0.5;
    ctx.moveTo(sx, Y(y0));
    ctx.lineTo(sx, Y(y1));
  }
  for (let y = y0; y <= y1; y++) {
    const sy = Math.round(Y(y)) + 0.5;
    ctx.moveTo(X(x0), sy);
    ctx.lineTo(X(x1), sy);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.35)';
  ctx.stroke();
}
