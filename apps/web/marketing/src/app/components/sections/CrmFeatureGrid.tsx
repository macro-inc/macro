import { For, type JSX } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  Cube,
  cubeFaces,
  cubeSilhouette,
  FAINT_EDGE,
  IsoFigure,
  IsoLine,
  Tile,
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

// --- Fig 0.1 — Builds from email -------------------------------------------
// An envelope cube at the top, with connection lines flowing down into a set
// of stacked contact/company cubes, symbolizing records building from email.
function FigBuildsFromEmail(props: { height: string }) {
  const env = { cx: 80, cy: 38, w: 18, h: 14 };
  const contacts = [
    { cx: 52, cy: 80, w: 11, h: 16 },
    { cx: 80, cy: 86, w: 11, h: 16 },
    { cx: 108, cy: 80, w: 11, h: 16 },
  ];
  const envMid = v(80, 52);
  const spokes = contacts.map((c) => ({
    from: towards(envMid, v(c.cx, c.cy), 12),
    to: towards(v(c.cx, c.cy), envMid, 14),
  }));
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={spokes}>
        {(sp) => (
          <IsoLine
            class="crm-fig-flow"
            from={sp.from}
            to={sp.to}
            dashed
            opacity={0.5}
          />
        )}
      </For>
      <For each={contacts}>
        {(c, i) => (
          <g
            class="crm-fig-sat"
            style={{ 'animation-delay': `${-i() * 0.7}s` }}
          >
            <Cube cx={c.cx} cy={c.cy} w={c.w} h={c.h} />
          </g>
        )}
      </For>
      <g class="crm-fig-pulse">
        <OpaqueCube cx={env.cx} cy={env.cy} w={env.w} h={env.h} />
      </g>
    </IsoFigure>
  );
}

// --- Fig 0.2 — Auto-enriched -----------------------------------------------
// A central contact cube; glowing data tiles rain in from above and settle
// on its faces, symbolizing enrichment filling in the fields automatically.
function FigAutoEnriched(props: { height: string }) {
  const contact = { cx: 80, cy: 80, w: 20, h: 28 };
  const tiles = [
    { cx: 44, cy: 46, w: 14, t: 3 },
    { cx: 80, cy: 38, w: 14, t: 3 },
    { cx: 116, cy: 46, w: 14, t: 3 },
  ];
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={tiles}>
        {(tile, i) => (
          <g
            class="crm-fig-drop"
            style={{ 'animation-delay': `${i() * 0.55}s` }}
          >
            <Tile cx={tile.cx} cy={tile.cy} w={tile.w} t={tile.t} />
          </g>
        )}
      </For>
      <g class="crm-fig-hover">
        <OpaqueCube
          cx={contact.cx}
          cy={contact.cy}
          w={contact.w}
          h={contact.h}
        />
      </g>
    </IsoFigure>
  );
}

// --- Fig 0.3 — Discussion & context ----------------------------------------
// Two person cubes flanking a central tall tower (thread / discussion).
// Dashed lines arc between them; the tower pulses like a growing thread.
function FigDiscussion(props: { height: string }) {
  const tower = { cx: 80, cy: 60, w: 14, h: 40 };
  const persons = [
    { cx: 42, cy: 82, w: 10, h: 14 },
    { cx: 118, cy: 82, w: 10, h: 14 },
  ];
  const towerMid = v(80, 80);
  const spokes = persons.map((p) => ({
    from: towards(towerMid, v(p.cx, p.cy), 14),
    to: towards(v(p.cx, p.cy), towerMid, 13),
  }));
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={spokes}>
        {(sp) => (
          <IsoLine
            class="crm-fig-flow"
            from={sp.from}
            to={sp.to}
            dashed
            opacity={0.5}
          />
        )}
      </For>
      <For each={persons}>
        {(p, i) => (
          <g
            class="crm-fig-sat"
            style={{ 'animation-delay': `${i() * -0.9}s` }}
          >
            <Cube cx={p.cx} cy={p.cy} w={p.w} h={p.h} />
          </g>
        )}
      </For>
      <g class="crm-fig-pulse">
        <OpaqueCube cx={tower.cx} cy={tower.cy} w={tower.w} h={tower.h} />
      </g>
    </IsoFigure>
  );
}

// --- Fig 0.4 — Agent keeps it current --------------------------------------
// A sparkle (agent) hovers above a CRM record; dashed update lines pulse
// outward to surrounding field cubes, showing live maintenance.
function FigAgentCurrent(props: { height: string }) {
  const record = { cx: 80, cy: 74, w: 22, h: 30 };
  const fields = [
    { cx: 36, cy: 60, w: 9, h: 12 },
    { cx: 124, cy: 60, w: 9, h: 12 },
    { cx: 36, cy: 100, w: 9, h: 12 },
    { cx: 124, cy: 100, w: 9, h: 12 },
  ];
  const recMid = v(80, 89);
  const spokes = fields.map((f) => ({
    from: towards(recMid, v(f.cx, f.cy), 20),
    to: towards(v(f.cx, f.cy), recMid, 11),
  }));
  return (
    <IsoFigure height={props.height} viewBox={VIEW_BOX} strokeWidth={1.4}>
      <For each={spokes}>
        {(sp) => (
          <IsoLine
            class="crm-fig-flow"
            from={sp.from}
            to={sp.to}
            dashed
            opacity={0.45}
          />
        )}
      </For>
      <For each={fields}>
        {(f, i) => (
          <g
            class="crm-fig-sat"
            style={{ 'animation-delay': `${-i() * 0.6}s` }}
          >
            <Cube cx={f.cx} cy={f.cy} w={f.w} h={f.h} />
          </g>
        )}
      </For>
      <g class="crm-fig-hover">
        <OpaqueCube cx={record.cx} cy={record.cy} w={record.w} h={record.h} />
      </g>
      <Sparkle class="crm-fig-sparkle" cx={80} cy={36} scale={1.4} />
    </IsoFigure>
  );
}

type GridTile = {
  fig: string;
  title: string;
  body: string;
  Fig: (props: { height: string }) => JSX.Element;
};

const tiles: GridTile[] = [
  {
    fig: 'Fig 0.1',
    title: 'Builds from email',
    body: 'New contacts and companies added automatically.',
    Fig: FigBuildsFromEmail,
  },
  {
    fig: 'Fig 0.2',
    title: 'Auto-enriched',
    body: 'Firmographics, headcount, and role filled in.',
    Fig: FigAutoEnriched,
  },
  {
    fig: 'Fig 0.3',
    title: 'Discussion & context',
    body: 'Every email and note attached to the record.',
    Fig: FigDiscussion,
  },
  {
    fig: 'Fig 0.4',
    title: 'Agent keeps it current',
    body: 'An agent fixes stale fields and flags risk.',
    Fig: FigAgentCurrent,
  },
];

const crmFeatureStyles = `
  @keyframes crmFigFlow {
    to { stroke-dashoffset: -24; }
  }
  @keyframes crmFigSat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-3px); }
  }
  @keyframes crmFigPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.65; }
  }
  @keyframes crmFigHover {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-4px); }
  }
  @keyframes crmFigDrop {
    0%, 100% { transform: translateY(0) scale(1); opacity: 1; }
    50% { transform: translateY(-5px) scale(1.05); opacity: 0.75; }
  }
  @keyframes crmFigSparkle {
    0%, 100% { transform: scale(1) rotate(0deg); opacity: 1; }
    33% { transform: scale(1.25) rotate(15deg); opacity: 0.85; }
    66% { transform: scale(0.85) rotate(-10deg); opacity: 1; }
  }
  @media (prefers-reduced-motion: no-preference) {
    .crm-fig-tile .crm-fig-flow { animation: crmFigFlow 2.4s linear infinite; }
    .crm-fig-tile .crm-fig-sat { animation: crmFigSat 3s ease-in-out infinite; }
    .crm-fig-tile .crm-fig-pulse { animation: crmFigPulse 2.8s ease-in-out infinite; }
    .crm-fig-tile .crm-fig-hover { animation: crmFigHover 3.2s ease-in-out infinite; }
    .crm-fig-tile .crm-fig-drop { animation: crmFigDrop 2.6s ease-in-out infinite; }
    .crm-fig-tile .crm-fig-sparkle { animation: crmFigSparkle 2.2s ease-in-out infinite; }
  }
`;

export function CrmFeatureGrid() {
  const mobile = () => viewportWidth() < 700;
  const mid = () => viewportWidth() < 1000;
  const colCount = () => (mobile() ? 1 : mid() ? 2 : 4);

  return (
    <section
      aria-label="CRM features"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '96px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <style>{crmFeatureStyles}</style>
      <div
        style={{
          display: 'grid',
          'grid-template-columns': `repeat(${colCount()}, minmax(0, 1fr))`,
          'max-width': '1080px',
          width: '100%',
        }}
      >
        <For each={tiles}>
          {(tile, index) => (
            <div
              class="crm-fig-tile"
              style={{
                'border-left':
                  index() % colCount() !== 0
                    ? `1px solid color-mix(in srgb, var(--b4) 20%, transparent)`
                    : 'none',
                'border-top':
                  index() >= colCount()
                    ? `1px solid color-mix(in srgb, var(--b4) 20%, transparent)`
                    : 'none',
                'box-sizing': 'border-box',
                display: 'grid',
                'grid-template-rows': 'auto 1fr',
                padding: mobile() ? '28px 0' : '32px 24px',
              }}
            >
              {/* Iso figure — tinted with the orange accent to match the other
                  feature pages' figure grids (they inherit --a0 from the grid). */}
              <div
                style={{
                  color: 'color-mix(in srgb, var(--a0) 34%, transparent)',
                  display: 'grid',
                  'justify-items': 'center',
                  'margin-bottom': mobile() ? '20px' : '24px',
                }}
              >
                <tile.Fig height={mobile() ? '110px' : '120px'} />
              </div>
              {/* Text */}
              <div style={{ display: 'grid', gap: '10px' }}>
                <span
                  style={{
                    color: 'color-mix(in srgb, var(--c4) 55%, transparent)',
                    'font-family': 'rajdhani, body',
                    'font-size': '11px',
                    'font-weight': '600',
                    'letter-spacing': '0.1em',
                    'text-transform': 'uppercase',
                  }}
                >
                  {tile.fig}
                </span>
                <h3
                  style={{
                    color: 'var(--c2)',
                    'font-family': 'body',
                    'font-size': mobile() ? '14px' : '15px',
                    'font-weight': '700',
                    'letter-spacing': '0.05em',
                    'line-height': 1.2,
                    margin: 0,
                    'text-transform': 'uppercase',
                  }}
                >
                  {tile.title}
                </h3>
                <p
                  style={{
                    color: 'var(--c4)',
                    'font-family': 'body',
                    'font-size': mobile() ? '15px' : '15px',
                    'font-weight': '400',
                    'line-height': 1.55,
                    margin: 0,
                  }}
                >
                  {tile.body}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
