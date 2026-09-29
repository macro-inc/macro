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

// Four GitHub figures sharing the home/documents isometric language: thin accent
// outlines, faint see-through fills, slow low-amplitude motion that pauses for
// reduced-motion visitors. Invented for this page (PRs landing in the inbox,
// @mention web, two-way sync, reliable notifications).

const VIEW_BOX = '0 0 160 150';

// See-through wireframe cube with an *opaque* backing, so nearer blocks occlude
// the trail/lines behind them (mirrors DocumentsFeatureGrid's OpaqueCube).
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

// --- Fig 01 — PRs in your inbox -------------------------------------------
// A stack of flat inbox tiles; the topmost (a PR) drops in and settles, while
// the whole stack softly floats.
function FigInbox(props: { height: string }) {
  // Three stacked tiles, top one is the incoming PR.
  const rows = [
    { cx: 80, cy: 96, w: 38, h: 8 },
    { cx: 80, cy: 80, w: 38, h: 8 },
  ];
  const pr = { cx: 80, cy: 60, w: 38, h: 8 };
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <g class="gf-hover-stack">
        <For each={rows}>
          {(r, i) => (
            <g class="gf-float" style={{ 'animation-delay': `${-i() * 0.7}s` }}>
              <OpaqueCube cx={r.cx} cy={r.cy} w={r.w} h={r.h} opacity={0.55} />
            </g>
          )}
        </For>
        {/* Incoming PR tile — drops down into the stack, then repeats. */}
        <g class="gf-drop">
          <OpaqueCube cx={pr.cx} cy={pr.cy} w={pr.w} h={pr.h} />
          {/* PR glyph hint: a small fork stroke on the tile's top face. */}
          <circle
            class="gf-dot"
            cx={64}
            cy={56}
            r={2.4}
            fill="currentColor"
            stroke="none"
          />
        </g>
      </g>
    </IsoFigure>
  );
}

// --- Fig 02 — @mention anywhere -------------------------------------------
// A central PR cube with links radiating to satellites (message, doc, task,
// channel); dashes flow outward and the satellites softly float.
function FigMention(props: { height: string }) {
  const pr = { cx: 80, cy: 58, w: 14, h: 22 };
  const prMid = v(80, 72);
  const sats = [
    { cx: 34, cy: 48, w: 7, h: 9 },
    { cx: 126, cy: 48, w: 7, h: 9 },
    { cx: 40, cy: 104, w: 7, h: 9 },
    { cx: 120, cy: 104, w: 7, h: 9 },
  ];
  const spokes = sats.map((s) => {
    const c = v(s.cx, s.cy);
    return { from: towards(prMid, c, 18), to: towards(c, prMid, 12) };
  });
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={spokes}>
        {(sp) => (
          <IsoLine
            class="gf-flow"
            from={sp.from}
            to={sp.to}
            dashed
            opacity={0.5}
          />
        )}
      </For>
      <For each={sats}>
        {(s, i) => (
          <g class="gf-float" style={{ 'animation-delay': `${-i() * 0.8}s` }}>
            <Cube cx={s.cx} cy={s.cy} w={s.w} h={s.h} />
          </g>
        )}
      </For>
      <g class="gf-hover-doc">
        <g class="gf-pulse">
          <OpaqueCube cx={pr.cx} cy={pr.cy} w={pr.w} h={pr.h} />
        </g>
      </g>
    </IsoFigure>
  );
}

// --- Fig 03 — Comments synced both ways -----------------------------------
// Macro's copy and GitHub's copy of the same PR orbit a shared sync ring whose
// dashes flow; each bobs in opposite phase.
function FigSync(props: { height: string }) {
  const left = { cx: 56, cy: 76, w: 12, h: 16 };
  const right = { cx: 104, cy: 72, w: 12, h: 16 };
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <ellipse
        class="gf-orbit"
        cx={80}
        cy={82}
        rx={52}
        ry={22}
        fill="none"
        stroke="currentColor"
        stroke-dasharray="3 6"
        style={{ opacity: 0.5 }}
      />
      <g class="gf-bob-a">
        <Cube cx={left.cx} cy={left.cy} w={left.w} h={left.h} />
      </g>
      <g class="gf-bob-b">
        <Cube cx={right.cx} cy={right.cy} w={right.w} h={right.h} />
      </g>
    </IsoFigure>
  );
}

// --- Fig 04 — Notifications that work -------------------------------------
// A solid PR cube with a notification badge that pulses, and a ping ring that
// expands out and fades — a reliable, noticed alert.
function FigNotify(props: { height: string }) {
  const main = { cx: 80, cy: 70, w: 16, h: 22 };
  const badge = v(96, 56); // upper-right of the cube's top face
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      {/* Expanding ping rings behind the badge. */}
      <g class="gf-hover-doc">
        <circle
          class="gf-ping"
          cx={badge.x}
          cy={badge.y}
          r={6}
          fill="none"
          stroke="currentColor"
        />
        <circle
          class="gf-ping gf-ping--delay"
          cx={badge.x}
          cy={badge.y}
          r={6}
          fill="none"
          stroke="currentColor"
        />
        <g class="gf-float">
          <OpaqueCube cx={main.cx} cy={main.cy} w={main.w} h={main.h} />
        </g>
        {/* Solid notification badge dot. */}
        <g class="gf-pulse">
          <circle
            cx={badge.x}
            cy={badge.y}
            r={5.5}
            fill="currentColor"
            stroke="none"
          />
        </g>
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
    slug: 'inbox',
    fig: 'Fig 01',
    title: 'PRs in your inbox',
    body: 'Pull requests and review requests land in the same fast list as email and chat.',
    Graphic: FigInbox,
  },
  {
    slug: 'mention',
    fig: 'Fig 02',
    title: '@mention anywhere',
    body: '@mention a PR in a message, doc, or task — it becomes a live link with status and checks.',
    Graphic: FigMention,
  },
  {
    slug: 'sync',
    fig: 'Fig 03',
    title: 'Comments synced both ways',
    body: 'Comment in Macro and it posts to GitHub. Comment on GitHub and it shows up here.',
    Graphic: FigSync,
  },
  {
    slug: 'notify',
    fig: 'Fig 04',
    title: 'Notifications that work',
    body: 'Review requests and @mentions get reliable push and unread state, so nothing gets buried.',
    Graphic: FigNotify,
  },
];

const githubFeatureStyles = `
  /* Idle motion — all gentle, all paused for reduced-motion visitors. */
  @keyframes gfFlowOut { to { stroke-dashoffset: -14; } }
  .gf-flow { animation: gfFlowOut var(--gf-flow-dur, 1.5s) linear infinite; }

  @keyframes gfFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  .gf-float {
    animation: gfFloat 5s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes gfPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }
  .gf-pulse {
    animation: gfPulse 4.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes gfDrop {
    0%      { transform: translateY(-22px); opacity: 0; }
    24%     { transform: translateY(0); opacity: 1; }
    86%     { transform: translateY(0); opacity: 1; }
    100%    { transform: translateY(-22px); opacity: 0; }
  }
  .gf-drop {
    animation: gfDrop 4.4s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  .gf-dot { opacity: 0.85; }

  @keyframes gfOrbit { to { stroke-dashoffset: -36; } }
  .gf-orbit { animation: gfOrbit 3.2s linear infinite; }

  .gf-bob-a {
    animation: gfFloat 4.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  .gf-bob-b {
    animation: gfFloat 4.6s ease-in-out infinite;
    animation-delay: -2.3s;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes gfPing {
    0%   { transform: scale(0.4); opacity: 0.7; }
    80%  { transform: scale(2.2); opacity: 0; }
    100% { transform: scale(2.2); opacity: 0; }
  }
  .gf-ping {
    animation: gfPing 2.8s ease-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  .gf-ping--delay { animation-delay: 1.4s; }

  /* Hover nudges compose with the idle motion instead of restarting it. */
  @media (hover) {
    .gf-pillar--inbox:hover .gf-drop { animation-duration: 2.6s; }
    .gf-pillar--mention:hover .gf-flow { --gf-flow-dur: 0.9s; }
    .gf-pillar--mention:hover .gf-hover-doc { transform: scale(1.04); }
    .gf-pillar--sync:hover .gf-orbit { animation-duration: 1.8s; }
    .gf-pillar--notify:hover .gf-ping { animation-duration: 1.8s; }
    .gf-pillar--notify:hover .gf-hover-doc { transform: scale(1.04); }
    .gf-hover-doc, .gf-hover-stack {
      transform-box: fill-box;
      transform-origin: center;
      transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .gf-pillar--inbox:hover .gf-hover-stack { transform: scale(1.04); }
  }

  @media (prefers-reduced-motion: reduce) {
    .gf-flow, .gf-float, .gf-pulse, .gf-drop, .gf-orbit,
    .gf-bob-a, .gf-bob-b, .gf-ping {
      animation: none;
    }
  }
`;

// A single row of the GitHub fundamentals (4-wide, collapsing to 2 then 1) —
// same divider-and-figure language as the documents / home page pillars, with
// from-scratch animated isometric figures.
export function GithubFeatureGrid() {
  const mobile = () => viewportWidth() < 700;
  const colCount = () => (mobile() ? 1 : viewportWidth() < 1000 ? 2 : 4);
  const figureHeight = () => (mobile() ? '146px' : '150px');
  const figureArea = () => (mobile() ? '164px' : '172px');

  return (
    <section
      aria-label="Why Macro Reviews"
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
      <style>{githubFeatureStyles}</style>

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
              class={`gf-pillar gf-pillar--${pillar.slug}`}
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
                  'font-weight': '500',
                  'letter-spacing': '0.14em',
                  'margin-top': '20px',
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
