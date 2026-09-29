import type { JSX } from 'solid-js';

// --- Isometric line-art primitives ----------------------------------------
// A single 30° isometric projection shared across the home figures so every
// shape reads the same: thin outlines, faint top/side fills, dim stroke.
// Used by both EmailFeatureFigures and SectionHomeIntro.

const fmt = (n: number) => n.toFixed(1);

export function cubeFaces(cx: number, cy: number, w: number, height: number) {
  const h = w / 2;
  const top = `M${fmt(cx)},${fmt(cy - h)} L${fmt(cx + w)},${fmt(cy)} L${fmt(cx)},${fmt(cy + h)} L${fmt(cx - w)},${fmt(cy)} Z`;
  const left = `M${fmt(cx - w)},${fmt(cy)} L${fmt(cx)},${fmt(cy + h)} L${fmt(cx)},${fmt(cy + h + height)} L${fmt(cx - w)},${fmt(cy + height)} Z`;
  const right = `M${fmt(cx)},${fmt(cy + h)} L${fmt(cx + w)},${fmt(cy)} L${fmt(cx + w)},${fmt(cy + height)} L${fmt(cx)},${fmt(cy + h + height)} Z`;
  return { top, left, right };
}

// Outer hexagonal silhouette of a cube/tile, as a closed path — stroked vibrantly
// so the bounding outline reads strong while the inner edges stay faint.
export function cubeSilhouette(
  cx: number,
  cy: number,
  w: number,
  height: number
) {
  const h = w / 2;
  const pts = [
    [cx, cy - h],
    [cx + w, cy],
    [cx + w, cy + height],
    [cx, cy + h + height],
    [cx - w, cy + height],
    [cx - w, cy],
  ];
  return (
    pts.map(([x, y], i) => `${i ? 'L' : 'M'}${fmt(x)},${fmt(y)}`).join(' ') +
    ' Z'
  );
}

// Interior face-division edges. Kept lighter than the vibrant outer silhouette
// but bright enough that the cubes read as see-through wireframes (strokes over
// fills) rather than solid shaded blocks.
export const FAINT_EDGE = 'color-mix(in srgb, currentColor 45%, transparent)';

export type Vec2 = { x: number; y: number };

// The eight corners of a cube whose top-face centre is (cx, cy).
export function cubeVertices(
  cx: number,
  cy: number,
  w: number,
  height: number
) {
  const h = w / 2;
  return {
    tTop: { x: cx, y: cy - h },
    tRight: { x: cx + w, y: cy },
    tBottom: { x: cx, y: cy + h },
    tLeft: { x: cx - w, y: cy },
    bTop: { x: cx, y: cy - h + height },
    bRight: { x: cx + w, y: cy + height },
    bBottom: { x: cx, y: cy + h + height },
    bLeft: { x: cx - w, y: cy + height },
  } satisfies Record<string, Vec2>;
}

export function Cube(props: { cx: number; cy: number; w: number; h: number }) {
  const f = () => cubeFaces(props.cx, props.cy, props.w, props.h);
  return (
    <>
      <path
        d={f().left}
        fill="color-mix(in srgb, color-mix(in srgb, currentColor 30%, var(--c1)) 4%, color-mix(in srgb, var(--b0) 85%, transparent))"
        stroke={FAINT_EDGE}
      />
      <path
        d={f().right}
        fill="color-mix(in srgb, color-mix(in srgb, currentColor 30%, var(--c1)) 7%, color-mix(in srgb, var(--b0) 85%, transparent))"
        stroke={FAINT_EDGE}
      />
      <path
        d={f().top}
        fill="color-mix(in srgb, color-mix(in srgb, currentColor 30%, var(--c1)) 11%, color-mix(in srgb, var(--b0) 85%, transparent))"
        stroke={FAINT_EDGE}
      />
      <path
        d={cubeSilhouette(props.cx, props.cy, props.w, props.h)}
        fill="none"
        stroke="currentColor"
      />
    </>
  );
}

export function Tile(props: { cx: number; cy: number; w: number; t: number }) {
  const f = () => cubeFaces(props.cx, props.cy, props.w, props.t);
  return (
    <>
      <path
        d={f().left}
        fill="color-mix(in srgb, color-mix(in srgb, currentColor 30%, var(--c1)) 4%, color-mix(in srgb, var(--b0) 85%, transparent))"
        stroke={FAINT_EDGE}
      />
      <path
        d={f().right}
        fill="color-mix(in srgb, color-mix(in srgb, currentColor 30%, var(--c1)) 7%, color-mix(in srgb, var(--b0) 85%, transparent))"
        stroke={FAINT_EDGE}
      />
      <path
        d={f().top}
        fill="color-mix(in srgb, color-mix(in srgb, currentColor 30%, var(--c1)) 11%, color-mix(in srgb, var(--b0) 85%, transparent))"
        stroke={FAINT_EDGE}
      />
      <path
        d={cubeSilhouette(props.cx, props.cy, props.w, props.t)}
        fill="none"
        stroke="currentColor"
      />
    </>
  );
}

export function IsoLine(props: {
  from: Vec2;
  to: Vec2;
  dashed?: boolean;
  opacity?: number;
  class?: string;
}) {
  return (
    <line
      class={props.class}
      x1={props.from.x}
      y1={props.from.y}
      x2={props.to.x}
      y2={props.to.y}
      stroke-dasharray={props.dashed ? '3 4' : undefined}
      style={{ opacity: props.opacity ?? 1 }}
    />
  );
}

export function IsoFigure(props: {
  height: string;
  viewBox?: string;
  strokeWidth?: number;
  children: JSX.Element;
}) {
  return (
    <svg
      viewBox={props.viewBox ?? '0 0 140 128'}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width={props.strokeWidth ?? 1.4}
      stroke-linejoin="round"
      stroke-linecap="round"
      style={{
        display: 'block',
        height: props.height,
        overflow: 'visible',
        width: '100%',
      }}
    >
      {props.children}
    </svg>
  );
}
