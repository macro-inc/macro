import {
  Cube,
  cubeFaces,
  cubeVertices,
  IsoFigure,
  IsoLine,
} from './IsoLineArt';

const VIEW_BOX = '0 0 160 150';

// The large see-through frame, defined once so the line-art and the panel
// glass overlay stay in lock-step.
const BIG = { cx: 80, cy: 45, w: 52, h: 60 };

// The frame breathes slowly while the hidden back edges flow, so the see-through
// construction keeps drawing the eye. Pauses for reduced motion.
const styles = `
  @keyframes hiBreathe {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.028); }
  }
  @keyframes hiDash { to { stroke-dashoffset: -14; } }
  .hi-breathe {
    animation: hiBreathe 6s ease-in-out infinite;
    transform-box: view-box;
    transform-origin: center;
  }
  .hi-dash { animation: hiDash 2.8s linear infinite; }
  @media (prefers-reduced-motion: reduce) {
    .hi-breathe, .hi-dash { animation: none; }
  }
`;

// Fig 03 — "Open source": an open-topped box. The side walls are filled glass,
// but the top face is left unfilled (open), so you see straight into the hollow
// — nothing hidden inside.
export function HomeFigOpenSource(props: { height: string }) {
  const v = cubeVertices(BIG.cx, BIG.cy, BIG.w, BIG.h);
  const big = cubeFaces(BIG.cx, BIG.cy, BIG.w, BIG.h);
  const glass = 'color-mix(in srgb, var(--b1) 20%, transparent)';
  return (
    <>
      <style>{styles}</style>
      <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
        <g class="hi-breathe">
          {/* hidden back edges, dashed, seen through the open top */}
          <IsoLine
            class="hi-dash"
            from={v.tTop}
            to={v.bTop}
            dashed
            opacity={0.2}
          />
          <IsoLine
            class="hi-dash"
            from={v.bTop}
            to={v.bLeft}
            dashed
            opacity={0.2}
          />
          <IsoLine
            class="hi-dash"
            from={v.bTop}
            to={v.bRight}
            dashed
            opacity={0.2}
          />
          {/* side verticals (left + right corners) */}
          <IsoLine from={v.tLeft} to={v.bLeft} />
          <IsoLine from={v.tRight} to={v.bRight} />
        </g>
        {/* filled glass side walls */}
        <g class="hi-breathe">
          <path d={big.left} fill={glass} stroke="none" />
          <path d={big.right} fill={glass} stroke="none" />
        </g>
        {/* the two front bottom edges are part of the outer silhouette (vibrant);
            the front vertical "middle line" runs inside it (muted). */}
        <g class="hi-breathe">
          <IsoLine from={v.tBottom} to={v.bBottom} opacity={0.2} />
          <IsoLine from={v.bLeft} to={v.bBottom} />
          <IsoLine from={v.bBottom} to={v.bRight} />
        </g>
        {/* the open top — a fainter glass fill over the opening. The back rim is
            part of the outer silhouette (vibrant); the front rim meets the
            interior near-corner (tBottom), so it's muted like the other inner lines. */}
        <g class="hi-breathe">
          <path
            d={big.top}
            fill="color-mix(in srgb, var(--b1) 10%, transparent)"
            stroke="none"
          />
          <IsoLine from={v.tLeft} to={v.tTop} />
          <IsoLine from={v.tTop} to={v.tRight} />
          {/* front rim of the opening — vibrant so the open top reads clearly */}
          <IsoLine from={v.tRight} to={v.tBottom} />
          <IsoLine from={v.tBottom} to={v.tLeft} />
        </g>
        {/* a cube nestled inside the open box, centred on the box's centre of
            mass (big box: (80, 45+60/2)=(80,75); small: (80, cy+22/2)) */}
        <g class="hi-inner">
          <Cube cx={80} cy={64} w={20} h={22} />
        </g>
      </IsoFigure>
    </>
  );
}
