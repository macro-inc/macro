import { For } from 'solid-js';
import {
  Cube,
  cubeVertices,
  IsoFigure,
  IsoLine,
  type Vec2,
} from './IsoLineArt';

const VIEW_BOX = '0 0 160 150';

// The central hub cube every spoke feeds into. Its silhouette is used to clip
// the spokes so no line shows "behind" it — each line stops on the cube's edge.
const HUB = { cx: 80, cy: 70, w: 20, h: 24 };
const HUB_ANCHOR = { x: 80, y: 86 };

// Satellite cubes are all this size; their three visible faces share a fixed
// geometry, so a face's mid-point is a constant offset from the cube centre.
const SAT_W = 8;
const SAT_H = 10;

// Outer silhouette (hexagon) of the iso hub cube, in outline order.
function hubSilhouette(): Vec2[] {
  const v = cubeVertices(HUB.cx, HUB.cy, HUB.w, HUB.h);
  return [v.tTop, v.tRight, v.bRight, v.bBottom, v.bLeft, v.tLeft];
}

// Mid-point of a satellite cube's left/right face — the spoke springs from here
// rather than the cube centre, so its outer end sits on the cube's surface.
function faceMid(center: Vec2, side: 'left' | 'right'): Vec2 {
  return {
    x: center.x + (side === 'right' ? SAT_W / 2 : -SAT_W / 2),
    y: center.y + SAT_W / 4 + SAT_H / 2,
  };
}

// Position (0..1 along from→to) where segment from→to crosses segment a→b,
// or null if they don't cross.
function crossParam(from: Vec2, to: Vec2, a: Vec2, b: Vec2): number | null {
  const rx = to.x - from.x;
  const ry = to.y - from.y;
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denom = rx * sy - ry * sx;
  if (denom === 0) return null;
  const t = ((a.x - from.x) * sy - (a.y - from.y) * sx) / denom;
  const u = ((a.x - from.x) * ry - (a.y - from.y) * rx) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}

// The point where the segment from→target first meets the hub silhouette
// (nearest to `from`), or `target` if it never does.
function clipToHub(from: Vec2, target: Vec2): Vec2 {
  const sil = hubSilhouette();
  let bestT = Infinity;
  for (let i = 0; i < sil.length; i++) {
    const t = crossParam(from, target, sil[i], sil[(i + 1) % sil.length]);
    if (t !== null && t < bestT) bestT = t;
  }
  if (!Number.isFinite(bestT)) return target;
  return {
    x: from.x + (target.x - from.x) * bestT,
    y: from.y + (target.y - from.y) * bestT,
  };
}

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

// Each spoke is a dashed line whose dashes march steadily inward toward the hub;
// the hub softly pulses as it receives. Pauses for visitors who prefer reduced motion.
const styles = `
  @keyframes hiHub {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.05); }
  }
  /* Dashes march along each spoke toward the hub. Negative offset flows in the
     path's draw direction (outer -> inner), so they always head to the centre. */
  @keyframes hiFlowIn {
    to { stroke-dashoffset: -14; }
  }
  .hi-flow-in { animation: hiFlowIn var(--hi-flow-dur, 1.3s) linear infinite; }
  .hi-hub {
    animation: hiHub 4.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .hi-hub, .hi-flow-in { animation: none; }
  }
`;

// Fig 02 — "Shared memory": a central store every part of the workspace feeds.
// Dashes march inward along each spoke while the hub softly pulses.
export function HomeFigSharedMemory(props: { height: string }) {
  // Two back cubes, level with each other, whose spokes run parallel to the
  // hub's iso edges (slope ±0.5) and begin at the cube's hub-facing face.
  const back = [
    { center: { x: 40, y: 64 }, face: 'right' as const, dir: { x: 2, y: 1 } },
    { center: { x: 120, y: 64 }, face: 'left' as const, dir: { x: -2, y: 1 } },
  ];
  // Lower side cubes — spokes run parallel to the hub's iso edges (slope ±0.5)
  // and over-shoot the edge by 25% so they read as pushing into the hub's side.
  const sides = [
    { center: { x: 32, y: 104 }, dir: { x: 2, y: -1 } },
    { center: { x: 128, y: 106 }, dir: { x: -2, y: -1 } },
  ];
  // Bottom cube — straight up into the hub, clipped at the edge.
  const bottom = { x: 80, y: 124 };

  type Spoke = { outer: Vec2; inner: Vec2; cube: Vec2 };
  const spokes: Spoke[] = [];

  for (const b of back) {
    const outer = faceMid(b.center, b.face);
    const far = { x: outer.x + b.dir.x * 1000, y: outer.y + b.dir.y * 1000 };
    spokes.push({ outer, inner: clipToHub(outer, far), cube: b.center });
  }
  for (const s of sides) {
    const outer = { x: s.center.x, y: s.center.y + 4 };
    const far = { x: outer.x + s.dir.x * 1000, y: outer.y + s.dir.y * 1000 };
    const edge = clipToHub(outer, far);
    spokes.push({ outer, inner: lerp(outer, edge, 1.25), cube: s.center }); // +25% past the edge
  }
  {
    const outer = { x: bottom.x, y: bottom.y + 4 };
    spokes.push({ outer, inner: clipToHub(outer, HUB_ANCHOR), cube: bottom });
  }

  const cubes = [
    ...back.map((b) => b.center),
    ...sides.map((s) => s.center),
    bottom,
  ];

  return (
    <>
      <style>{styles}</style>
      <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
        <For each={spokes}>
          {(sp) => (
            <IsoLine
              class="hi-flow-in"
              from={sp.outer}
              to={sp.inner}
              dashed
              opacity={0.55}
            />
          )}
        </For>
        <For each={cubes}>
          {(c) => <Cube cx={c.x} cy={c.y} w={SAT_W} h={SAT_H} />}
        </For>
        <g class="hi-hover-wrap hi-sm-hub">
          <g class="hi-hub">
            <Cube cx={HUB.cx} cy={HUB.cy} w={HUB.w} h={HUB.h} />
          </g>
        </g>
      </IsoFigure>
    </>
  );
}
