import { For, type JSX } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { Cube, IsoFigure, IsoLine, Tile } from '../graphics/IsoLineArt';

// Hover-driven motion for each calls figure tile. Transforms use fill-box so
// SVG groups move in place; lines and keycaps loop only while hovered. Mirrors
// the email feature-grid figures so the two pages read as one system.
const callsFigHoverStyles = `
  .cf-part {
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  @keyframes cfWave {
    0%, 100% { transform: scaleY(0.5); }
    50% { transform: scaleY(1.15); }
  }
  @keyframes cfPulse {
    0%, 100% { opacity: 0.25; transform: scale(0.9); }
    50% { opacity: 0.9; transform: scale(1.06); }
  }
  @keyframes cfScan {
    from { transform: translate(0, 0); }
    to { transform: translate(11px, 5.5px); }
  }
  @media (hover) {
    .calls-fig-tile:hover .cf-tr-top { transform: translateY(-11px); }
    .calls-fig-tile:hover .cf-tr-mid { transform: translateY(-2px); }
    .calls-fig-tile:hover .cf-tr-bot { transform: translateY(9px); }
    .calls-fig-tile:hover .cf-scan {
      animation: cfScan 0.9s ease-in-out infinite alternate;
      transform-box: fill-box;
      transform-origin: center;
    }
    .calls-fig-tile:hover .cf-mem-orbit { transform: translateY(-7px); }
    .calls-fig-tile:hover .cf-mem-left { transform: translate(-9px, 4px); }
    .calls-fig-tile:hover .cf-mem-right { transform: translate(9px, 4px); }
    .calls-fig-tile:hover .cf-agent-core { transform: translateY(-6px); }
    .calls-fig-tile:hover .cf-pulse {
      animation: cfPulse 1.4s ease-in-out infinite;
      transform-box: fill-box;
      transform-origin: center;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .cf-part { transition: none; }
    .cf-scan, .cf-pulse { animation: none !important; }
  }
`;

function FigureSvg(props: { mobile: boolean; children: JSX.Element }) {
  return (
    <IsoFigure height={props.mobile ? '108px' : '128px'}>
      {props.children}
    </IsoFigure>
  );
}

// Auto transcript & summary — a stack of transcript lines lifting off a base
// tile, reading as a generated document.
function FigTranscript(props: { mobile: boolean }) {
  return (
    <FigureSvg mobile={props.mobile}>
      <Tile cx={70} cy={92} w={36} t={6} />
      <g class="cf-part cf-tr-bot">
        <IsoLine from={{ x: 52, y: 70 }} to={{ x: 84, y: 86 }} opacity={0.7} />
      </g>
      <g class="cf-part cf-tr-mid">
        <IsoLine from={{ x: 50, y: 56 }} to={{ x: 90, y: 76 }} opacity={0.85} />
      </g>
      <g class="cf-part cf-tr-top">
        <IsoLine from={{ x: 54, y: 42 }} to={{ x: 80, y: 55 }} opacity={1} />
        <IsoLine from={{ x: 84, y: 57 }} to={{ x: 96, y: 63 }} opacity={0.5} />
      </g>
    </FigureSvg>
  );
}

// Searchable — a magnifier (small cube lens on an iso ray) sweeping across a
// field, reading as search over the archive.
function FigSearch(props: { mobile: boolean }) {
  return (
    <FigureSvg mobile={props.mobile}>
      <Tile cx={70} cy={86} w={40} t={6} />
      <g class="cf-part cf-scan">
        {/* lens ring */}
        <ellipse
          cx={66}
          cy={52}
          rx={15}
          ry={9}
          fill="none"
          stroke="currentColor"
        />
        {/* handle along the iso down-right axis */}
        <IsoLine from={{ x: 78, y: 58 }} to={{ x: 94, y: 66 }} opacity={1} />
      </g>
    </FigureSvg>
  );
}

// Shared team memory — a central memory cube with two satellite cubes orbiting,
// reading as a shared store the team reads from.
function FigMemory(props: { mobile: boolean }) {
  return (
    <FigureSvg mobile={props.mobile}>
      <g class="cf-part cf-mem-left">
        <Cube cx={48} cy={70} w={15} h={17} />
      </g>
      <g class="cf-part cf-mem-right">
        <Cube cx={94} cy={70} w={15} h={17} />
      </g>
      <g class="cf-part cf-mem-orbit">
        <Cube cx={70} cy={46} w={22} h={24} />
      </g>
    </FigureSvg>
  );
}

// Agents get call context — a core cube ringed by a pulsing field, reading as
// an agent drawing on surrounding context.
function FigAgent(props: { mobile: boolean }) {
  return (
    <FigureSvg mobile={props.mobile}>
      <g class="cf-part cf-pulse">
        <ellipse
          cx={70}
          cy={64}
          rx={44}
          ry={26}
          fill="none"
          stroke="currentColor"
          opacity={0.4}
        />
      </g>
      <g class="cf-part cf-pulse" style={{ 'animation-delay': '0.5s' }}>
        <ellipse
          cx={70}
          cy={64}
          rx={30}
          ry={18}
          fill="none"
          stroke="currentColor"
          opacity={0.5}
        />
      </g>
      <g class="cf-part cf-agent-core">
        <Cube cx={70} cy={52} w={18} h={20} />
      </g>
    </FigureSvg>
  );
}

type Figure = {
  fig: string;
  title: string;
  // Two-line split used on mobile so every tile's title occupies the same two
  // rows — keeps the figures and their subtext aligned across the grid.
  lines: [string, string];
  subtext: string;
  Graphic: (props: { mobile: boolean }) => JSX.Element;
};

const figures: Figure[] = [
  {
    fig: 'Fig 0.1',
    title: 'Auto transcript & summary',
    lines: ['Transcript', '& summary'],
    subtext: 'Every call, written up the moment it ends.',
    Graphic: FigTranscript,
  },
  {
    fig: 'Fig 0.2',
    title: 'Searchable',
    lines: ['Searchable', 'archive'],
    subtext: 'Find any moment across every past call.',
    Graphic: FigSearch,
  },
  {
    fig: 'Fig 0.3',
    title: 'Shared team memory',
    lines: ['Shared team', 'memory'],
    subtext: 'Calls land where your whole team can see them.',
    Graphic: FigMemory,
  },
  {
    fig: 'Fig 0.4',
    title: 'Agents get call context',
    lines: ['Agents get', 'call context'],
    subtext: 'Your agents were in the room with you.',
    Graphic: FigAgent,
  },
];

export function CallsFeatureGrid() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 920;

  return (
    <>
      <style>{callsFigHoverStyles}</style>
      <div
        style={{
          color: 'color-mix(in srgb, var(--a0) 34%, transparent)',
          display: 'grid',
          'grid-template-columns': stacked()
            ? 'repeat(2, minmax(0, 1fr))'
            : 'repeat(4, minmax(0, 1fr))',
          width: '100%',
        }}
      >
        <For each={figures}>
          {(item, index) => (
            <div
              class="calls-fig-tile"
              style={{
                'border-left': (stacked() ? index() % 2 !== 0 : index() > 0)
                  ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                  : 'none',
                'border-top':
                  stacked() && index() > 1
                    ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                    : 'none',
                'box-sizing': 'border-box',
                display: 'grid',
                gap: mobile() ? '18px' : '26px',
                'grid-template-rows': 'auto 1fr auto',
                padding: mobile() ? '24px 18px' : '28px 30px',
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
                {item.fig}
              </span>
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  'justify-content': 'center',
                }}
              >
                <item.Graphic mobile={mobile()} />
              </div>
              <div style={{ display: 'grid', gap: mobile() ? '5px' : '6px' }}>
                <span
                  style={{
                    color: 'var(--c2)',
                    'font-family': 'body',
                    'font-size': mobile() ? '13px' : '14px',
                    'font-weight': '700',
                    'letter-spacing': '0.07em',
                    'text-transform': 'uppercase',
                  }}
                >
                  {mobile() ? (
                    <>
                      {item.lines[0]}
                      <br />
                      {item.lines[1]}
                    </>
                  ) : (
                    item.title
                  )}
                </span>
                <span
                  style={{
                    color: 'color-mix(in srgb, var(--c4) 30%, transparent)',
                    'font-family': 'body',
                    'font-size': mobile() ? '12px' : '12.5px',
                    'font-weight': '500',
                    'letter-spacing': '0',
                    'line-height': 1.4,
                  }}
                >
                  {item.subtext}
                </span>
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  );
}
