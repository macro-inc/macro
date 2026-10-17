import type { PlotScene, Viewport } from './document';

export function worldToScreen(
  viewport: Viewport,
  width: number,
  height: number,
  x: number,
  y: number
): [number, number] {
  const sx = ((x - viewport.xmin) / (viewport.xmax - viewport.xmin)) * width;
  const sy =
    (1 - (y - viewport.ymin) / (viewport.ymax - viewport.ymin)) * height;
  return [sx, sy];
}

export function screenToWorld(
  viewport: Viewport,
  width: number,
  height: number,
  sx: number,
  sy: number
): [number, number] {
  const x = viewport.xmin + (sx / width) * (viewport.xmax - viewport.xmin);
  const y = viewport.ymax - (sy / height) * (viewport.ymax - viewport.ymin);
  return [x, y];
}

export function niceStep(span: number): number {
  const raw = span / 10;
  const power = 10 ** Math.floor(Math.log10(raw));
  const mantissa = raw / power;
  if (mantissa < 1.5) return power;
  if (mantissa < 3.5) return 2 * power;
  if (mantissa < 7.5) return 5 * power;
  return 10 * power;
}

export function panViewport(
  viewport: Viewport,
  dxWorld: number,
  dyWorld: number
): Viewport {
  return {
    xmin: viewport.xmin + dxWorld,
    xmax: viewport.xmax + dxWorld,
    ymin: viewport.ymin + dyWorld,
    ymax: viewport.ymax + dyWorld,
  };
}

/** Keep one graph unit square in pixels, adjusting y around its center. */
export function squareUnits(
  viewport: Viewport,
  width: number,
  height: number
): Viewport {
  if (!(width > 0 && height > 0)) return viewport;
  const xSpan = viewport.xmax - viewport.xmin;
  const ySpan = xSpan * (height / width);
  const cy = (viewport.ymin + viewport.ymax) / 2;
  return {
    xmin: viewport.xmin,
    xmax: viewport.xmax,
    ymin: cy - ySpan / 2,
    ymax: cy + ySpan / 2,
  };
}

export function defaultViewport(width: number, height: number): Viewport {
  return squareUnits(
    { xmin: -10, xmax: 10, ymin: -10, ymax: 10 },
    width,
    height
  );
}

export function zoomViewport(
  viewport: Viewport,
  factor: number,
  aroundX: number,
  aroundY: number
): Viewport {
  const zoom = (min: number, max: number, around: number) => {
    const nextMin = around - (around - min) * factor;
    const nextMax = around + (max - around) * factor;
    return nextMax > nextMin
      ? ([nextMin, nextMax] as const)
      : ([min, max] as const);
  };
  const [xmin, xmax] = zoom(viewport.xmin, viewport.xmax, aroundX);
  const [ymin, ymax] = zoom(viewport.ymin, viewport.ymax, aroundY);
  return { xmin, xmax, ymin, ymax };
}

export function paintGraph(
  ctx: CanvasRenderingContext2D,
  scene: PlotScene,
  width: number,
  height: number,
  dpr: number
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const viewport = scene.viewport;
  paintGrid(ctx, viewport, width, height);
  for (const item of scene.items) {
    if (item.kind === 'fill') {
      const [x, y] = worldToScreen(
        viewport,
        width,
        height,
        item.rect[0],
        item.rect[1] + item.rect[3]
      );
      const [x2, y2] = worldToScreen(
        viewport,
        width,
        height,
        item.rect[0] + item.rect[2],
        item.rect[1]
      );
      ctx.fillStyle = hexAlpha(item.color, 0.18);
      ctx.fillRect(x, y, x2 - x, y2 - y);
    }
  }
  for (const item of scene.items) {
    if (item.kind !== 'polyline' || item.points.length < 2) continue;
    ctx.beginPath();
    item.points.forEach(([x, y], index) => {
      const [sx, sy] = worldToScreen(viewport, width, height, x, y);
      if (index === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = item.color;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
  for (const item of scene.items) {
    if (item.kind !== 'point') continue;
    const [sx, sy] = worldToScreen(viewport, width, height, item.x, item.y);
    ctx.beginPath();
    ctx.fillStyle = '#ffffff';
    ctx.arc(sx, sy, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = item.color;
    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintGrid(
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  width: number,
  height: number
): void {
  const xStep = niceStep(viewport.xmax - viewport.xmin);
  const yStep = niceStep(viewport.ymax - viewport.ymin);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#f0f0f0';
  walkTicks(viewport.xmin, viewport.xmax, xStep / 2, (x) => {
    const [sx] = worldToScreen(viewport, width, height, x, 0);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();
  });
  walkTicks(viewport.ymin, viewport.ymax, yStep / 2, (y) => {
    const [, sy] = worldToScreen(viewport, width, height, 0, y);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
    ctx.stroke();
  });
  ctx.strokeStyle = '#e0e0e0';
  walkTicks(viewport.xmin, viewport.xmax, xStep, (x) => {
    if (Math.abs(x) < xStep / 4) return;
    const [sx] = worldToScreen(viewport, width, height, x, 0);
    ctx.beginPath();
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
    ctx.stroke();
  });
  walkTicks(viewport.ymin, viewport.ymax, yStep, (y) => {
    if (Math.abs(y) < yStep / 4) return;
    const [, sy] = worldToScreen(viewport, width, height, 0, y);
    ctx.beginPath();
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
    ctx.stroke();
  });
  const [ox, oy] = worldToScreen(viewport, width, height, 0, 0);
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, oy);
  ctx.lineTo(width, oy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ox, 0);
  ctx.lineTo(ox, height);
  ctx.stroke();
  ctx.fillStyle = '#666666';
  ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  walkTicks(viewport.xmin, viewport.xmax, xStep, (x) => {
    if (Math.abs(x) < xStep / 4) return;
    const [sx] = worldToScreen(viewport, width, height, x, 0);
    ctx.fillText(formatTick(x), sx, Math.min(height - 14, oy + 4));
  });
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  walkTicks(viewport.ymin, viewport.ymax, yStep, (y) => {
    if (Math.abs(y) < yStep / 4) return;
    const [, sy] = worldToScreen(viewport, width, height, 0, y);
    ctx.fillText(formatTick(y), Math.max(18, ox - 6), sy);
  });
}

function walkTicks(
  min: number,
  max: number,
  step: number,
  visit: (value: number) => void
) {
  if (!(step > 0)) return;
  const start = Math.ceil(min / step - 1e-9) * step;
  for (let value = start; value <= max + step / 2; value += step) {
    visit(Number(value.toPrecision(8)));
  }
}

function formatTick(value: number): string {
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1000 || abs < 0.01)) return value.toExponential(0);
  return String(Number(value.toPrecision(6)));
}

function hexAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const n = Number.parseInt(
    value.length === 3 ? value.replace(/./g, (c) => c + c) : value,
    16
  );
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
