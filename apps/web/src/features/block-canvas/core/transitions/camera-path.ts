import type { Bounds, Point } from '@macro-inc/graphics';

/** A camera over the canvas: the world point at the stage's center, and the
 * zoom in screen pixels per world unit. */
export type View = Readonly<{ x: number; y: number; zoom: number }>;
export type Size = Readonly<{ width: number; height: number }>;
export type CameraPath = (t: number) => View;

/** The part of an artifact's box its document fills: the design size scaled to
 * fit and centered, as `ArtifactFrame` lays it out. */
export function artifactContentRect(box: Bounds, design: Size): Bounds {
  const scale = Math.min(box.width / design.width, box.height / design.height);
  const width = design.width * scale;
  const height = design.height * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** The view that shows `rect` fitted and centered on the stage, as present mode
 * shows a slide full screen. `margin` leaves that fraction free on each side. */
export function fitView(rect: Bounds, stage: Size, margin = 0): View {
  const room = 1 - margin * 2;
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    zoom: Math.min(
      (stage.width * room) / rect.width,
      (stage.height * room) / rect.height
    ),
  };
}

/** Where `view` puts the world rectangle `rect`, in stage pixels. */
export function screenRect(view: View, rect: Bounds, stage: Size): Bounds {
  return {
    x: (rect.x - view.x) * view.zoom + stage.width / 2,
    y: (rect.y - view.y) * view.zoom + stage.height / 2,
    width: rect.width * view.zoom,
    height: rect.height * view.zoom,
  };
}

/** The world rectangle `view` shows. */
export function visibleRect(view: View, stage: Size): Bounds {
  const width = stage.width / view.zoom;
  const height = stage.height / view.zoom;
  return { x: view.x - width / 2, y: view.y - height / 2, width, height };
}

const logLerp = (a: number, b: number, t: number) =>
  Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);

/** A straight pan. Zoom changes geometrically, so equal slides keep a constant
 * zoom and unequal ones scale at an even perceived rate. */
export function panPath(from: View, to: View): CameraPath {
  return (t) => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    zoom: logLerp(from.zoom, to.zoom, t),
  });
}

/**
 * Van Wijk and Nuij's smooth zoom-and-pan ("Smooth and efficient zooming and
 * panning", 2003): the path that minimizes perceived motion pulls back in
 * proportion to the distance, then settles in. `w` is the visible world width
 * and `u` the distance travelled along the line between the centers; `rho`
 * trades zooming against panning (√2 is the paper's recommendation).
 */
export function flyPath(from: View, to: View, stage: Size, rho = Math.SQRT2): CameraPath {
  const w0 = stage.width / from.zoom;
  const w1 = stage.width / to.zoom;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const u1 = Math.hypot(dx, dy);
  const rho2 = rho * rho;

  // Nearly the same center: zoom alone, at the same exponential rate.
  if (u1 < 1e-6 * Math.max(w0, w1)) return panPath(from, to);

  const b = (wi: number, sign: number) =>
    (w1 * w1 - w0 * w0 + sign * rho2 * rho2 * u1 * u1) / (2 * wi * rho2 * u1);
  const r = (bi: number) => Math.log(-bi + Math.sqrt(bi * bi + 1));
  const r0 = r(b(w0, 1));
  const r1 = r(b(w1, -1));
  const length = (r1 - r0) / rho;

  return (t) => {
    if (t <= 0) return from;
    if (t >= 1) return to;

    const s = t * length;
    const u =
      (w0 / rho2) * (Math.cosh(r0) * Math.tanh(rho * s + r0) - Math.sinh(r0));
    const w = (w0 * Math.cosh(r0)) / Math.cosh(rho * s + r0);
    return {
      x: from.x + (dx * u) / u1,
      y: from.y + (dy * u) / u1,
      zoom: stage.width / w,
    };
  };
}

/** Pulls back to the whole canvas, holds briefly, then settles on the next
 * slide; each leg is a smooth zoom. */
export function overviewPath(
  from: View,
  to: View,
  overview: View,
  stage: Size,
  hold = 0.16
): CameraPath {
  const out = flyPath(from, overview, stage);
  const back = flyPath(overview, to, stage);
  const leg = (1 - hold) / 2;
  return (t) => {
    if (t < leg) return out(t / leg);
    if (t <= leg + hold) return overview;
    return back((t - leg - hold) / leg);
  };
}

/** A polyline's point at fraction `s` of its length. */
export function pointAlong(points: readonly Point[], s: number): Point {
  const first = points[0];
  if (!first) throw new Error('Empty route');

  const lengths = points.slice(1).map((point, index) => {
    const previous = points[index]!;
    return Math.hypot(point.x - previous.x, point.y - previous.y);
  });
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (total === 0) return first;

  let remaining = Math.min(1, Math.max(0, s)) * total;
  for (const [index, length] of lengths.entries()) {
    if (remaining <= length || index === lengths.length - 1) {
      const a = points[index]!;
      const b = points[index + 1]!;
      const k = length === 0 ? 0 : Math.min(1, remaining / length);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    remaining -= length;
  }
  return points[points.length - 1]!;
}

export function routeLength(points: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Follows a route from one slide's center to the other's at an even speed.
 * The camera pulls back toward the middle so the route reads as a journey:
 * at most half the route's length, never closer than either slide.
 */
export function routePath(from: View, to: View, route: readonly Point[], stage: Size): CameraPath {
  const points = [{ x: from.x, y: from.y }, ...route, { x: to.x, y: to.y }];
  const widest = Math.max(stage.width / from.zoom, stage.width / to.zoom);
  const pullBack = Math.max(1, routeLength(points) / 2 / widest);
  return (t) => {
    const center = pointAlong(points, t);
    const settled = logLerp(from.zoom, to.zoom, t);
    return {
      x: center.x,
      y: center.y,
      zoom: settled / (1 + (pullBack - 1) * Math.sin(Math.PI * t)),
    };
  };
}

/** A CSS transform for an element that draws the world at `baseScale` with its
 * top-left at world `origin`, so the stage shows `view`. */
export function cameraTransform(view: View, origin: Point, baseScale: number, stage: Size): string {
  const x = (origin.x - view.x) * view.zoom + stage.width / 2;
  const y = (origin.y - view.y) * view.zoom + stage.height / 2;
  return `translate(${x}px, ${y}px) scale(${view.zoom / baseScale})`;
}

/** Samples an eased path into the views a keyframe animation interpolates
 * between linearly. */
export function sampleViews(path: CameraPath, ease: (t: number) => number, samples: number): View[] {
  const count = Math.max(2, Math.round(samples));
  return Array.from({ length: count }, (_, index) =>
    path(ease(index / (count - 1)))
  );
}

/** The world rectangle enclosing every sampled view. */
export function coveredRect(views: readonly View[], stage: Size): Bounds {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const view of views) {
    const rect = visibleRect(view, stage);
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
