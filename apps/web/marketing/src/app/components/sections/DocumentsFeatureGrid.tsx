import { For, type JSX } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  Cube,
  cubeFaces,
  cubeSilhouette,
  FAINT_EDGE,
  IsoFigure,
  IsoLine,
  type Vec2,
} from '../graphics/IsoLineArt';

// All four documents figures share the home-figure isometric language: thin
// accent outlines, faint see-through fills, and slow, low-amplitude motion that
// pauses for visitors who prefer reduced motion. They're invented for this page
// (mentions web, live agent cursor, CRDT sync, raw speed) rather than reused.

const VIEW_BOX = '0 0 160 150';

// Like HomeFigAllInOne's cube: a see-through wireframe with very faint face
// fills but an *opaque* backing, so nearer blocks occlude the trail behind them.
function OpaqueCube(props: {
  cx: number;
  cy: number;
  w: number;
  h: number;
  opacity?: number;
}) {
  const f = () => cubeFaces(props.cx, props.cy, props.w, props.h);
  return (
    <g style={{ opacity: props.opacity ?? 1 }}>
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
    </g>
  );
}

const v = (x: number, y: number): Vec2 => ({ x, y });

// A point `dist` from `a` heading toward `b`.
function towards(a: Vec2, b: Vec2, dist: number): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + (dx / len) * dist, y: a.y + (dy / len) * dist };
}

// A small four-point sparkle (the "agent"), centred on (cx, cy).
function Sparkle(props: {
  cx: number;
  cy: number;
  scale: number;
  class?: string;
}) {
  return (
    <g
      class={props.class}
      style={{ 'transform-box': 'fill-box', 'transform-origin': 'center' }}
    >
      <path
        transform={`translate(${props.cx} ${props.cy}) scale(${props.scale}) translate(-12 -12)`}
        d="M12 4c.5 5 2.6 7.1 7.5 7.6C14.6 12 12.5 14.2 12 19.2c-.5-5-2.6-7.1-7.5-7.6C9.4 11 11.5 8.9 12 4z"
        fill="currentColor"
        stroke="none"
      />
    </g>
  );
}

// --- Fig 01 — @mention web -------------------------------------------------
// A central document with links radiating out to people, tasks, mail, and
// channels; dashes flow outward along each link, and the doc softly pulses.
function FigMention(props: { height: string }) {
  const doc = { cx: 80, cy: 58, w: 13, h: 26 };
  const docMid = v(80, 74);
  const sats = [
    { cx: 34, cy: 48, w: 7, h: 9 },
    { cx: 126, cy: 48, w: 7, h: 9 },
    { cx: 40, cy: 104, w: 7, h: 9 },
    { cx: 120, cy: 104, w: 7, h: 9 },
  ];
  const spokes = sats.map((s) => {
    const c = v(s.cx, s.cy);
    return { from: towards(docMid, c, 17), to: towards(c, docMid, 12) };
  });
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={spokes}>
        {(sp) => (
          <IsoLine
            class="df-flow"
            from={sp.from}
            to={sp.to}
            dashed
            opacity={0.5}
          />
        )}
      </For>
      <For each={sats}>
        {(s, i) => (
          <g class="df-sat" style={{ 'animation-delay': `${-i() * 0.8}s` }}>
            <Cube cx={s.cx} cy={s.cy} w={s.w} h={s.h} />
          </g>
        )}
      </For>
      <g class="df-hover-doc">
        <g class="df-pulse">
          <OpaqueCube cx={doc.cx} cy={doc.cy} w={doc.w} h={doc.h} />
        </g>
      </g>
    </IsoFigure>
  );
}

// --- Fig 02 — Live agent cursor -------------------------------------------
// A document whose lines are already written; an agent (sparkle) hovers above
// while a live caret hops down the lines, writing in real time.
function FigAgentCursor(props: { height: string }) {
  const doc = { cx: 66, cy: 56, w: 22, h: 36 };
  // Three "text" rows laid on the cube's right face, parallel to its top edge.
  const P = (p: number, d: number): Vec2 => ({
    x: 66 + 22 * p,
    y: 67 - 11 * p + d,
  });
  const rows = [
    { from: P(0.1, 8), to: P(0.62, 8) },
    { from: P(0.1, 15), to: P(0.5, 15) },
    { from: P(0.1, 22), to: P(0.36, 22) },
  ];
  const caretBase = rows[0].to; // caret starts at the end of row 1
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <g class="df-hover-doc">
        <Cube cx={doc.cx} cy={doc.cy} w={doc.w} h={doc.h} />
        <For each={rows}>
          {(r) => <IsoLine from={r.from} to={r.to} opacity={0.4} />}
        </For>
        {/* Live caret — hops between the three row ends, blinking as it goes. */}
        <g class="df-caret-hop">
          <line
            class="df-blink"
            x1={caretBase.x}
            y1={caretBase.y - 4.5}
            x2={caretBase.x}
            y2={caretBase.y + 4.5}
            stroke="currentColor"
            stroke-width={2.4}
          />
        </g>
      </g>
      <Sparkle cx={100} cy={40} scale={0.95} class="df-star" />
    </IsoFigure>
  );
}

// --- Fig 03 — Real-time & offline -----------------------------------------
// Two people's copies of the same doc orbit a shared sync ring whose dashes
// flow continuously; live carets blink on each, in opposite phase.
function FigSync(props: { height: string }) {
  const left = { cx: 56, cy: 76, w: 11, h: 15 };
  const right = { cx: 104, cy: 72, w: 11, h: 15 };
  const caret = (c: { cx: number; cy: number; w: number }) => {
    const top = c.cy - c.w / 2; // top vertex of the cube's top face
    return { x: c.cx, y1: top - 8, y2: top - 1 };
  };
  const cl = caret(left);
  const cr = caret(right);
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <ellipse
        class="df-orbit"
        cx={80}
        cy={82}
        rx={52}
        ry={22}
        fill="none"
        stroke="currentColor"
        stroke-dasharray="3 6"
        style={{ opacity: 0.5 }}
      />
      <g class="df-bob-a">
        <Cube cx={left.cx} cy={left.cy} w={left.w} h={left.h} />
        <line
          class="df-blink"
          x1={cl.x}
          y1={cl.y1}
          x2={cl.x}
          y2={cl.y2}
          stroke="currentColor"
          stroke-width={2.2}
        />
      </g>
      <g class="df-bob-b">
        <Cube cx={right.cx} cy={right.cy} w={right.w} h={right.h} />
        <line
          class="df-blink df-blink--delay"
          x1={cr.x}
          y1={cr.y1}
          x2={cr.x}
          y2={cr.y2}
          stroke="currentColor"
          stroke-width={2.2}
        />
      </g>
    </IsoFigure>
  );
}

// --- Fig 04 — Built for speed ---------------------------------------------
// A solid block tears forward along the iso travel axis, leaving translucent
// after-images and a field of speed streaks that rush past and fade.
function FigSpeed(props: { height: string }) {
  const main = { cx: 100, cy: 70, w: 16, h: 20 };
  const ghosts = [
    { cx: 82, cy: 61, opacity: 0.5 },
    { cx: 66, cy: 53, opacity: 0.3 },
    { cx: 52, cy: 46, opacity: 0.16 },
  ];
  const streaks: { from: Vec2; to: Vec2; o: number; delay: number }[] = [
    { from: v(28, 50), to: v(46, 59), o: 0.5, delay: 0 },
    { from: v(34, 66), to: v(50, 74), o: 0.45, delay: 0.12 },
    { from: v(24, 60), to: v(38, 67), o: 0.35, delay: 0.06 },
    { from: v(40, 44), to: v(56, 52), o: 0.3, delay: 0.2 },
    { from: v(38, 78), to: v(54, 86), o: 0.4, delay: 0.16 },
    { from: v(30, 72), to: v(42, 78), o: 0.28, delay: 0.26 },
  ];
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={streaks}>
        {(s) => (
          <g
            class="df-streak"
            style={{ '--df-o': String(s.o), 'animation-delay': `${s.delay}s` }}
          >
            <IsoLine from={s.from} to={s.to} opacity={s.o} />
          </g>
        )}
      </For>
      <For each={ghosts}>
        {(g) => (
          <OpaqueCube
            cx={g.cx}
            cy={g.cy}
            w={main.w}
            h={main.h}
            opacity={g.opacity}
          />
        )}
      </For>
      <g class="df-dart">
        <OpaqueCube cx={main.cx} cy={main.cy} w={main.w} h={main.h} />
      </g>
    </IsoFigure>
  );
}

type Pillar = {
  slug: string;
  fig: string;
  title: string;
  body: string;
  Graphic: (props: { height: string }) => JSX.Element;
};

const pillars: Pillar[] = [
  {
    slug: 'mention',
    fig: 'Fig 01',
    title: '@mention anything',
    body: '@mention people, docs, tasks, email, and calls right in the page.',
    Graphic: FigMention,
  },
  {
    slug: 'agent',
    fig: 'Fig 02',
    title: 'Agentic editing',
    body: 'Agents edit alongside you with a real live cursor — not just a diff.',
    Graphic: FigAgentCursor,
  },
  {
    slug: 'sync',
    fig: 'Fig 03',
    title: 'Real-time & offline',
    body: 'Built on CRDTs — edit the same line together, even offline.',
    Graphic: FigSync,
  },
  {
    slug: 'speed',
    fig: 'Fig 04',
    title: 'Built for speed',
    body: 'A Rust backend and a SolidJS frontend, so everything is instant.',
    Graphic: FigSpeed,
  },
];

const documentsFeatureStyles = `
  /* Idle motion — all gentle, all paused for reduced-motion visitors. */
  @keyframes dfFlowOut { to { stroke-dashoffset: -14; } }
  .df-flow { animation: dfFlowOut var(--df-flow-dur, 1.5s) linear infinite; }

  @keyframes dfPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  .df-pulse {
    animation: dfPulse 4.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes dfFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  .df-sat {
    animation: dfFloat 5s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes dfCaretHop {
    0%, 20%   { transform: translate(0, 0); }
    30%, 50%  { transform: translate(-2.6px, 8.3px); }
    60%, 80%  { transform: translate(-5.7px, 16.9px); }
    90%, 100% { transform: translate(0, 0); }
  }
  .df-caret-hop {
    animation: dfCaretHop 4s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes dfBlink { 0%, 52% { opacity: 1; } 53%, 100% { opacity: 0.12; } }
  .df-blink { animation: dfBlink 1s steps(1) infinite; }
  .df-blink--delay { animation-delay: 0.5s; }

  @keyframes dfStar { 0%, 100% { transform: scale(0.88); opacity: 0.55; } 50% { transform: scale(1.12); opacity: 1; } }
  .df-star { animation: dfStar 3.2s ease-in-out infinite; }

  @keyframes dfOrbit { to { stroke-dashoffset: -36; } }
  .df-orbit { animation: dfOrbit 3.2s linear infinite; }

  .df-bob-a {
    animation: dfFloat 4.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  .df-bob-b {
    animation: dfFloat 4.6s ease-in-out infinite;
    animation-delay: -2.3s;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes dfStreak {
    from { transform: translate(0, 0); opacity: var(--df-o, 0.45); }
    to   { transform: translate(16px, 8px); opacity: 0; }
  }
  .df-streak {
    animation: dfStreak 0.62s linear infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes dfDart {
    0%, 100% { transform: translate(0, 0); }
    50%      { transform: translate(5px, 2.5px); }
  }
  .df-dart {
    animation: dfDart 0.9s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  /* Hover nudges compose with the idle motion instead of restarting it. */
  @media (hover) {
    .df-pillar--mention:hover .df-flow { --df-flow-dur: 0.9s; }
    .df-pillar--mention:hover .df-hover-doc { transform: scale(1.04); }
    .df-pillar--agent:hover .df-caret-hop { animation-duration: 2.4s; }
    .df-pillar--sync:hover .df-orbit { animation-duration: 1.8s; }
    .df-pillar--speed:hover .df-streak { animation-duration: 0.4s; }
    .df-pillar--speed:hover .df-dart { animation-duration: 0.55s; }
    .df-hover-doc {
      transform-box: fill-box;
      transform-origin: center;
      transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .df-flow, .df-pulse, .df-sat, .df-caret-hop, .df-blink, .df-star,
    .df-orbit, .df-bob-a, .df-bob-b, .df-streak, .df-dart {
      animation: none;
    }
  }
`;

// A single row of the documents fundamentals (4-wide, collapsing to 2 then 1) —
// same divider-and-figure language as the home page's "What is Macro" pillars,
// with from-scratch animated isometric figures.
export function DocumentsFeatureGrid() {
  const mobile = () => viewportWidth() < 700;
  const colCount = () => (mobile() ? 1 : viewportWidth() < 1000 ? 2 : 4);
  const figureHeight = () => (mobile() ? '146px' : '150px');
  const figureArea = () => (mobile() ? '164px' : '172px');

  return (
    <section
      aria-label="Why Macro Docs"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '40px' : '56px',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <style>{documentsFeatureStyles}</style>

      <div
        style={{
          color: 'color-mix(in srgb, var(--a0) 34%, transparent)',
          display: 'grid',
          'grid-template-columns': `repeat(${colCount()}, minmax(0, 1fr))`,
          'max-width': '1160px',
          width: '100%',
        }}
      >
        <For each={pillars}>
          {(pillar, index) => (
            <div
              class={`df-pillar df-pillar--${pillar.slug}`}
              style={{
                'align-content': 'start',
                'border-left':
                  index() % colCount() !== 0
                    ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                    : 'none',
                'border-top':
                  index() >= colCount()
                    ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                    : 'none',
                'box-sizing': 'border-box',
                display: 'grid',
                gap: mobile() ? '20px' : '24px',
                padding: mobile() ? '32px 20px' : '38px 28px',
              }}
            >
              <span
                style={{
                  color: 'color-mix(in srgb, var(--c4) 60%, transparent)',
                  'font-family': 'rajdhani, body',
                  'font-size': mobile() ? '11px' : '12px',
                  'font-weight': '700',
                  'letter-spacing': '0.14em',
                  'text-transform': 'uppercase',
                }}
              >
                {pillar.fig}
              </span>
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  height: figureArea(),
                  'justify-content': 'center',
                  width: '100%',
                }}
              >
                <pillar.Graphic height={figureHeight()} />
              </div>
              <div style={{ display: 'grid', gap: mobile() ? '8px' : '10px' }}>
                <h3
                  style={{
                    color: 'var(--c2)',
                    'font-family': 'body',
                    'font-size': mobile() ? '14px' : '15px',
                    'font-weight': '700',
                    'letter-spacing': '0.07em',
                    'line-height': 1.2,
                    margin: 0,
                    'text-transform': 'uppercase',
                  }}
                >
                  {pillar.title}
                </h3>
                <p
                  style={{
                    color: 'color-mix(in srgb, var(--c4) 62%, transparent)',
                    'font-family': 'body',
                    'font-size': mobile() ? '15px' : '16px',
                    'font-weight': '400',
                    'line-height': 1.5,
                    margin: 0,
                    'max-width': '420px',
                  }}
                >
                  {pillar.body}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
