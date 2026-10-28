import { For } from 'solid-js';
import {
  cubeFaces,
  cubeSilhouette,
  FAINT_EDGE,
  IsoFigure,
  Tile,
} from './IsoLineArt';

const VIEW_BOX = '0 0 160 150';

// Like the shared `Cube`: a see-through wireframe with very faint transparent
// face fills, a vibrant bounding silhouette, and lighter interior edges — so
// strokes dominate and blocks behind stay partly visible through the ones in
// front, matching the rest of the figures.
function OpaqueCube(props: { cx: number; cy: number; w: number; h: number }) {
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

// Low-amplitude, slow float so the blocks read as "alive" rather than animated.
// Pauses entirely for visitors who prefer reduced motion.
const styles = `
  @keyframes hiFloat {
    0%, 100% { transform: translateY(0); }
    50%      { transform: translateY(-3px); }
  }
  .hi-cube {
    animation: hiFloat 5s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .hi-cube { animation: none; }
  }
`;

// Fig 01 — "All in one": a unifying platform carrying the whole stack of tools.
// The platform stays anchored while each block hovers on its own gentle, offset
// rhythm, so the cluster looks like it's settling together rather than marching.
export function HomeFigAllInOne(props: { height: string }) {
  // The two enlarged blocks grow UPWARD from their original footprint — bottom
  // (cy + w/2 + h) kept fixed, top-face cy raised — so the cluster still rests on
  // the same baseline. Ordered back-to-front by that fixed front-bottom vertex:
  // the furthest-back block is painted first, so nearer blocks' opaque fills
  // occlude those behind them.
  const blocks = [
    { cx: 72, cy: 53, w: 10, h: 13, delay: -0.3, dur: 5.4, wrap: 'hi-aio-0' },
    { cx: 92, cy: 48, w: 13, h: 42, delay: -2.1, dur: 4.7, wrap: 'hi-aio-1' },
    { cx: 62, cy: 75.5, w: 20, h: 22, delay: -1.2, dur: 5.8, wrap: 'hi-aio-2' },
    { cx: 98, cy: 94, w: 12, h: 11, delay: -3.4, dur: 5.0, wrap: 'hi-aio-3' },
  ];
  return (
    <>
      <style>{styles}</style>
      <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
        <Tile cx={80} cy={112} w={52} t={6} />
        <For each={blocks}>
          {(b) => (
            <g class={`hi-hover-wrap ${b.wrap}`}>
              <g
                class="hi-cube"
                style={{
                  'animation-delay': `${b.delay}s`,
                  'animation-duration': `${b.dur}s`,
                }}
              >
                <OpaqueCube cx={b.cx} cy={b.cy} w={b.w} h={b.h} />
              </g>
            </g>
          )}
        </For>
      </IsoFigure>
    </>
  );
}
