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

const VIEW_BOX = '0 0 160 150';

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

function towards(a: Vec2, b: Vec2, dist: number): Vec2 {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + (dx / len) * dist, y: a.y + (dy / len) * dist };
}

// --- Fig 01 — Whole-workspace context --------------------------------------
// Central doc with 6 source cubes radiating out — like reading everything at once.
function FigContext(props: { height: string }) {
  const center = { cx: 80, cy: 58, w: 13, h: 26 };
  const centerMid = v(80, 74);
  const sats = [
    { cx: 34, cy: 48, w: 7, h: 9 },
    { cx: 126, cy: 48, w: 7, h: 9 },
    { cx: 40, cy: 104, w: 7, h: 9 },
    { cx: 120, cy: 104, w: 7, h: 9 },
    { cx: 80, cy: 116, w: 7, h: 9 },
    { cx: 80, cy: 28, w: 7, h: 9 },
  ];
  const spokes = sats.map((s) => {
    const c = v(s.cx, s.cy);
    return { from: towards(centerMid, c, 17), to: towards(c, centerMid, 12) };
  });
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={spokes}>
        {(sp) => (
          <IsoLine
            class="af-flow"
            from={sp.from}
            to={sp.to}
            dashed
            opacity={0.5}
          />
        )}
      </For>
      <For each={sats}>
        {(s, i) => (
          <g class="af-sat" style={{ 'animation-delay': `${-i() * 0.7}s` }}>
            <Cube cx={s.cx} cy={s.cy} w={s.w} h={s.h} />
          </g>
        )}
      </For>
      <g class="af-hover-doc">
        <g class="af-pulse">
          <OpaqueCube cx={center.cx} cy={center.cy} w={center.w} h={center.h} />
        </g>
      </g>
    </IsoFigure>
  );
}

// --- Fig 02 — Team-level memory --------------------------------------------
// A persistent stack of memory layers with the whole team's context converging
// into it from above — shared recall that outlives any single conversation.
function FigMemory(props: { height: string }) {
  // Bottom-first so upper slabs paint over the ones below (DB-style ridges).
  const layers = [
    { cx: 80, cy: 92, w: 20, h: 8 },
    { cx: 80, cy: 80, w: 20, h: 8 },
    { cx: 80, cy: 68, w: 20, h: 8 },
  ];
  const mates = [
    { cx: 44, cy: 42, w: 7, h: 9 },
    { cx: 80, cy: 30, w: 7, h: 9 },
    { cx: 116, cy: 42, w: 7, h: 9 },
  ];
  const target = v(80, 60);
  const spokes = mates.map((m) => {
    const c = v(m.cx, m.cy);
    return { from: towards(c, target, 13), to: towards(target, c, 9) };
  });
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={spokes}>
        {(sp) => (
          <IsoLine
            class="af-flow"
            from={sp.from}
            to={sp.to}
            dashed
            opacity={0.5}
          />
        )}
      </For>
      <For each={mates}>
        {(m, i) => (
          <g class="af-sat" style={{ 'animation-delay': `${-i() * 0.7}s` }}>
            <Cube cx={m.cx} cy={m.cy} w={m.w} h={m.h} />
          </g>
        )}
      </For>
      <g class="af-hover-doc">
        <g class="af-pulse">
          <For each={layers}>
            {(l) => <OpaqueCube cx={l.cx} cy={l.cy} w={l.w} h={l.h} />}
          </For>
        </g>
      </g>
    </IsoFigure>
  );
}

// --- Fig 04 — Runs on a schedule ------------------------------------------
// A dart/fast-block racing along a timeline with trailing ghost images.
function FigSchedule(props: { height: string }) {
  const main = { cx: 100, cy: 68, w: 15, h: 20 };
  const ghosts = [
    { cx: 82, cy: 60, opacity: 0.5 },
    { cx: 66, cy: 52, opacity: 0.3 },
    { cx: 52, cy: 45, opacity: 0.16 },
  ];
  const streaks: { from: Vec2; to: Vec2; o: number; delay: number }[] = [
    { from: v(28, 50), to: v(46, 58), o: 0.5, delay: 0 },
    { from: v(34, 64), to: v(50, 72), o: 0.45, delay: 0.12 },
    { from: v(24, 58), to: v(38, 65), o: 0.35, delay: 0.06 },
    { from: v(40, 44), to: v(56, 51), o: 0.3, delay: 0.2 },
    { from: v(38, 76), to: v(54, 83), o: 0.38, delay: 0.16 },
  ];
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={streaks}>
        {(s) => (
          <g
            class="af-streak"
            style={{ '--af-o': String(s.o), 'animation-delay': `${s.delay}s` }}
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
      <g class="af-dart">
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
    slug: 'context',
    fig: 'Fig 01',
    title: 'Whole-workspace context',
    body: 'Reads your email, messages, tasks, docs, calls, and CRM in one pass.',
    Graphic: FigContext,
  },
  {
    slug: 'memory',
    fig: 'Fig 02',
    title: 'Team-level memory',
    body: 'Macro knows what your team is working on — shared context that carries across every chat.',
    Graphic: FigMemory,
  },
  {
    slug: 'schedule',
    fig: 'Fig 03',
    title: 'Runs on a schedule',
    body: 'Set up recurring automations — results land in your inbox automatically.',
    Graphic: FigSchedule,
  },
];

const agentsFeatureStyles = `
  @keyframes afFlowOut { to { stroke-dashoffset: -14; } }
  .af-flow { animation: afFlowOut 1.5s linear infinite; }

  @keyframes afPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  .af-pulse {
    animation: afPulse 4.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes afFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  .af-sat {
    animation: afFloat 5s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes afStreak {
    from { transform: translate(0, 0); opacity: var(--af-o, 0.45); }
    to   { transform: translate(16px, 8px); opacity: 0; }
  }
  .af-streak {
    animation: afStreak 0.62s linear infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes afDart {
    0%, 100% { transform: translate(0, 0); }
    50%      { transform: translate(5px, 2.5px); }
  }
  .af-dart {
    animation: afDart 0.9s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @media (hover) {
    .af-pillar--context:hover .af-flow { animation-duration: 0.9s; }
    .af-pillar--context:hover .af-hover-doc { transform: scale(1.04); }
    .af-pillar--memory:hover .af-flow { animation-duration: 0.9s; }
    .af-pillar--memory:hover .af-hover-doc { transform: scale(1.04); }
    .af-pillar--schedule:hover .af-streak { animation-duration: 0.4s; }
    .af-pillar--schedule:hover .af-dart { animation-duration: 0.55s; }
    .af-hover-doc {
      transform-box: fill-box;
      transform-origin: center;
      transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .af-flow, .af-pulse, .af-sat, .af-streak, .af-dart {
      animation: none;
    }
  }
`;

export function AgentsFeatureGrid() {
  const mobile = () => viewportWidth() < 700;
  const colCount = () => (mobile() ? 1 : viewportWidth() < 1000 ? 2 : 3);
  const figureHeight = () => (mobile() ? '146px' : '150px');
  const figureArea = () => (mobile() ? '164px' : '172px');

  return (
    <section
      aria-label="Why Macro Agents"
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
      <style>{agentsFeatureStyles}</style>

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
              class={`af-pillar af-pillar--${pillar.slug}`}
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
