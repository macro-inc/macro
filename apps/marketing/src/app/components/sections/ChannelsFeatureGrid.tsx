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

// Four Channels differentiators, each illustrated with a from-scratch isometric
// figure using the same IsoLineArt primitives as DocumentsFeatureGrid /
// EmailFeatureFigures. Animation classes (ch-*) mirror the df-* conventions.

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

// A small four-point sparkle (agent icon), centred on (cx, cy).
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

// --- Fig 01 — Inline threads -------------------------------------------------
// A tall main block (the parent message) with smaller reply blocks branching off
// to the right via a vertical rail, mirroring Macro's forum-style threads.
function FigInlineThreads(props: { height: string }) {
  const parent = { cx: 70, cy: 50, w: 18, h: 28 };
  const replies = [
    { cx: 108, cy: 60, w: 12, h: 16, delay: 0 },
    { cx: 112, cy: 86, w: 12, h: 16, delay: 0.5 },
    { cx: 116, cy: 112, w: 12, h: 16, delay: 1.0 },
  ];
  // Rail: from right edge of parent down to last reply
  const railX = parent.cx + parent.w - 2;
  const railFrom = v(railX, parent.cy + parent.h / 2 + 8);
  const railTo = v(railX, 112);
  // Connectors from rail to each reply's left edge
  const connectors = replies.map((r) => ({
    from: v(railX, r.cy),
    to: v(r.cx - r.w + 2, r.cy),
  }));

  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      {/* Vertical thread rail */}
      <IsoLine
        class="ch-flow"
        from={railFrom}
        to={railTo}
        dashed
        opacity={0.45}
      />
      {/* Horizontal connectors */}
      <For each={connectors}>
        {(c) => <IsoLine from={c.from} to={c.to} opacity={0.35} />}
      </For>
      {/* Reply blocks */}
      <For each={replies}>
        {(r, i) => (
          <g class="ch-reply" style={{ 'animation-delay': `${-i() * 0.9}s` }}>
            <Cube cx={r.cx} cy={r.cy} w={r.w} h={r.h} />
          </g>
        )}
      </For>
      {/* Parent message block */}
      <g class="ch-pulse">
        <OpaqueCube cx={parent.cx} cy={parent.cy} w={parent.w} h={parent.h} />
      </g>
    </IsoFigure>
  );
}

// --- Fig 02 — @link everything -----------------------------------------------
// A central node with links radiating outward to four satellite entity types
// (people, doc, task, channel). Dashed flow lines pulse outward.
function FigAtLink(props: { height: string }) {
  const hub = { cx: 80, cy: 64, w: 12, h: 18 };
  const hubMid = v(80, 76);
  const sats = [
    { cx: 36, cy: 44, w: 7, h: 9 },
    { cx: 124, cy: 44, w: 7, h: 9 },
    { cx: 42, cy: 106, w: 7, h: 9 },
    { cx: 118, cy: 106, w: 7, h: 9 },
  ];
  const spokes = sats.map((s) => {
    const c = v(s.cx, s.cy);
    return { from: towards(hubMid, c, 16), to: towards(c, hubMid, 11) };
  });

  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={spokes}>
        {(sp) => (
          <IsoLine
            class="ch-flow"
            from={sp.from}
            to={sp.to}
            dashed
            opacity={0.5}
          />
        )}
      </For>
      <For each={sats}>
        {(s, i) => (
          <g class="ch-sat" style={{ 'animation-delay': `${-i() * 0.7}s` }}>
            <Cube cx={s.cx} cy={s.cy} w={s.w} h={s.h} />
          </g>
        )}
      </For>
      <g class="ch-hover-hub">
        <g class="ch-pulse">
          <OpaqueCube cx={hub.cx} cy={hub.cy} w={hub.w} h={hub.h} />
        </g>
      </g>
    </IsoFigure>
  );
}

// --- Fig 03 — One inbox -------------------------------------------------------
// A large "inbox" block in the centre with smaller blocks from different sources
// (email, channel, task, mention) converging into it from all sides.
function FigOneInbox(props: { height: string }) {
  const inbox = { cx: 80, cy: 68, w: 20, h: 26 };
  const inboxMid = v(80, 78);
  const sources = [
    { cx: 38, cy: 50, w: 8, h: 10 },
    { cx: 122, cy: 50, w: 8, h: 10 },
    { cx: 42, cy: 104, w: 8, h: 10 },
    { cx: 118, cy: 104, w: 8, h: 10 },
    { cx: 80, cy: 28, w: 8, h: 10 },
  ];
  const arrows = sources.map((s) => {
    const c = v(s.cx, s.cy);
    return { from: towards(c, inboxMid, 12), to: towards(inboxMid, c, 20) };
  });

  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={arrows}>
        {(a, i) => (
          <g
            class="ch-converge"
            style={{ 'animation-delay': `${-i() * 0.6}s` }}
          >
            <IsoLine
              class="ch-flow-in"
              from={a.from}
              to={a.to}
              dashed
              opacity={0.45}
            />
          </g>
        )}
      </For>
      <For each={sources}>
        {(s, i) => (
          <g class="ch-sat" style={{ 'animation-delay': `${-i() * 0.55}s` }}>
            <Cube cx={s.cx} cy={s.cy} w={s.w} h={s.h} />
          </g>
        )}
      </For>
      <g class="ch-hover-hub">
        <g class="ch-pulse">
          <OpaqueCube cx={inbox.cx} cy={inbox.cy} w={inbox.w} h={inbox.h} />
        </g>
      </g>
    </IsoFigure>
  );
}

// --- Fig 04 — Agents in channels ---------------------------------------------
// A large doc block with a sparkle (agent) orbiting it above, while speed
// streaks flow past in the background — hinting at real-time AI work.
function FigAgents(props: { height: string }) {
  const main = { cx: 80, cy: 72, w: 18, h: 28 };
  const streaks: { from: Vec2; to: Vec2; o: number; delay: number }[] = [
    { from: v(30, 55), to: v(48, 63), o: 0.45, delay: 0 },
    { from: v(28, 70), to: v(44, 77), o: 0.38, delay: 0.14 },
    { from: v(36, 40), to: v(52, 48), o: 0.3, delay: 0.08 },
    { from: v(32, 82), to: v(46, 88), o: 0.35, delay: 0.22 },
    { from: v(110, 46), to: v(128, 54), o: 0.4, delay: 0.06 },
    { from: v(108, 60), to: v(124, 67), o: 0.32, delay: 0.18 },
  ];

  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={streaks}>
        {(s) => (
          <g
            class="ch-streak"
            style={{ '--ch-o': String(s.o), 'animation-delay': `${s.delay}s` }}
          >
            <IsoLine from={s.from} to={s.to} opacity={s.o} />
          </g>
        )}
      </For>
      <g class="ch-hover-hub">
        <OpaqueCube cx={main.cx} cy={main.cy} w={main.w} h={main.h} />
      </g>
      <Sparkle cx={80} cy={42} scale={1.0} class="ch-star" />
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
    slug: 'threads',
    fig: 'Fig 01',
    title: 'Inline threads',
    body: 'Replies sit under the parent message, not in a side panel — the channel stays readable.',
    Graphic: FigInlineThreads,
  },
  {
    slug: 'atlink',
    fig: 'Fig 02',
    title: '@link everything',
    body: '@mention a doc and it is shared; @mention a task and it links both ways.',
    Graphic: FigAtLink,
  },
  {
    slug: 'inbox',
    fig: 'Fig 03',
    title: 'One inbox',
    body: 'Channel @mentions, email, and tasks all land in one Signal-filtered list.',
    Graphic: FigOneInbox,
  },
  {
    slug: 'agents',
    fig: 'Fig 04',
    title: 'Agents in channels',
    body: '@Macro summarizes overnight, drafts replies, and works from your full workspace context.',
    Graphic: FigAgents,
  },
];

const channelsFeatureStyles = `
  @keyframes chFlowOut { to { stroke-dashoffset: -14; } }
  .ch-flow { animation: chFlowOut var(--ch-flow-dur, 1.6s) linear infinite; }

  @keyframes chFlowIn { to { stroke-dashoffset: 14; } }
  .ch-flow-in { animation: chFlowIn var(--ch-flow-dur, 1.6s) linear infinite; }

  @keyframes chPulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
  .ch-pulse {
    animation: chPulse 4.8s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes chFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  .ch-sat {
    animation: chFloat 5.2s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }
  .ch-reply {
    animation: chFloat 4.6s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes chStar { 0%, 100% { transform: scale(0.86); opacity: 0.52; } 50% { transform: scale(1.14); opacity: 1; } }
  .ch-star {
    animation: chStar 3.4s ease-in-out infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @keyframes chStreak {
    from { transform: translate(0, 0); opacity: var(--ch-o, 0.45); }
    to   { transform: translate(16px, 8px); opacity: 0; }
  }
  .ch-streak {
    animation: chStreak 0.64s linear infinite;
    transform-box: fill-box;
    transform-origin: center;
  }

  @media (hover) {
    .ch-pillar--threads:hover .ch-flow { --ch-flow-dur: 1.0s; }
    .ch-pillar--atlink:hover .ch-flow { --ch-flow-dur: 0.9s; }
    .ch-pillar--inbox:hover .ch-flow-in { --ch-flow-dur: 0.9s; }
    .ch-pillar--agents:hover .ch-streak { animation-duration: 0.4s; }
    .ch-pillar--agents:hover .ch-star { animation-duration: 2s; }
    .ch-hover-hub {
      transform-box: fill-box;
      transform-origin: center;
      transition: transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
    }
    .ch-pillar--threads:hover .ch-hover-hub,
    .ch-pillar--atlink:hover .ch-hover-hub,
    .ch-pillar--inbox:hover .ch-hover-hub,
    .ch-pillar--agents:hover .ch-hover-hub { transform: scale(1.04); }
  }

  @media (prefers-reduced-motion: reduce) {
    .ch-flow, .ch-flow-in, .ch-pulse, .ch-sat, .ch-reply, .ch-star, .ch-streak {
      animation: none;
    }
  }
`;

export function ChannelsFeatureGrid() {
  const mobile = () => viewportWidth() < 700;
  const colCount = () => (mobile() ? 1 : viewportWidth() < 1000 ? 2 : 4);
  const figureHeight = () => (mobile() ? '146px' : '150px');
  const figureArea = () => (mobile() ? '164px' : '172px');

  return (
    <section
      aria-label="Why Macro Chat"
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
      <style>{channelsFeatureStyles}</style>

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
              class={`ch-pillar ch-pillar--${pillar.slug}`}
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
