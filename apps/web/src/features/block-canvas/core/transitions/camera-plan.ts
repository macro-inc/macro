import {
  type ArtifactItem,
  type Bounds,
  type CANVAS_TRANSITION_KINDS,
  type GraphicsDocument,
  MAX_SCALE,
  MIN_SCALE,
  type Point,
} from '@macro-inc/graphics';
import { match } from 'ts-pattern';
import {
  type CameraPath,
  coveredRect,
  fitView,
  flyPath,
  overviewPath,
  panPath,
  routePath,
  type Size,
  sampleViews,
  screenRect,
  type View,
} from './camera-path';
import {
  connectorRoute,
  sceneBounds,
  slideContentRect,
} from './scene-geometry';

export type CanvasKind = (typeof CANVAS_TRANSITION_KINDS)[number];

/** Everything needed to draw and animate one camera move. */
export type CameraPlan = Readonly<{
  /** Eased camera positions, evenly spaced in time. */
  views: readonly View[];
  /** World rectangle the world layer must draw; the camera never leaves it. */
  region: Bounds;
  /** Screen pixels per world unit the world layer is drawn at. Never above a
   * view's zoom, so the animation only scales the layer up. */
  baseScale: number;
  /** Stage rectangles of the two slides at the start and end, which match how
   * present mode shows each slide. */
  fromScreen: Bounds;
  toScreen: Bounds;
  /** Whether a connector route was followed (`path` only). */
  followedRoute: boolean;
}>;

/** Keeps the world layer within what browsers rasterize comfortably. */
const MAX_LAYER_PX = 12_000;

export function cameraPlan(input: {
  document: GraphicsDocument;
  from: ArtifactItem;
  to: ArtifactItem;
  kind: CanvasKind;
  stage: Size;
  ease: (t: number) => number;
  durationMs: number;
}): CameraPlan {
  const fromRect = slideContentRect(input.document, input.from);
  const toRect = slideContentRect(input.document, input.to);
  const start = fitView(fromRect, input.stage);
  const end = fitView(toRect, input.stage);
  const route =
    input.kind === 'path'
      ? connectorRoute(input.document, input.from.id, input.to.id)
      : undefined;

  const path: CameraPath = match(input.kind)
    .with('pan', () => panPath(start, end))
    .with('fly', () => flyPath(start, end, input.stage))
    .with('overview', () =>
      overviewPath(
        start,
        end,
        overviewView(input.document, [fromRect, toRect], input.stage),
        input.stage
      )
    )
    .with('path', () =>
      route
        ? routePath(start, end, route, input.stage)
        : flyPath(start, end, input.stage)
    )
    .exhaustive();

  const samples = Math.min(150, Math.max(30, input.durationMs / 16));
  const views = sampleViews(path, input.ease, samples);
  const covered = coveredRect(views, input.stage);
  // Pad so linear interpolation between samples never reveals the layer edge.
  const pad = Math.max(covered.width, covered.height) * 0.05;
  const region = {
    x: covered.x - pad,
    y: covered.y - pad,
    width: covered.width + pad * 2,
    height: covered.height + pad * 2,
  };
  const minZoom = Math.min(...views.map((view) => view.zoom));
  // The editor drawing the layer clamps its camera to these scales.
  const baseScale = Math.max(
    MIN_SCALE,
    Math.min(
      MAX_SCALE,
      minZoom,
      MAX_LAYER_PX / Math.max(region.width, region.height)
    )
  );

  return {
    views,
    region,
    baseScale,
    fromScreen: screenRect(start, fromRect, input.stage),
    toScreen: screenRect(end, toRect, input.stage),
    followedRoute: !!route,
  };
}

function overviewView(
  document: GraphicsDocument,
  slides: readonly Bounds[],
  stage: Size
): View {
  const scene = sceneBounds(document);
  const rects = scene ? [scene, ...slides] : slides;
  const corners: Point[] = rects.flatMap((rect) => [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
  ]);
  const left = Math.min(...corners.map((p) => p.x));
  const top = Math.min(...corners.map((p) => p.y));
  const right = Math.max(...corners.map((p) => p.x));
  const bottom = Math.max(...corners.map((p) => p.y));
  return fitView(
    { x: left, y: top, width: right - left, height: bottom - top },
    stage,
    0.06
  );
}
