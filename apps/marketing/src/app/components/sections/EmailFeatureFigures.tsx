import { For, type JSX } from 'solid-js';
import KeyboardFig from '../../../assets/graphics/fig-keyboard.svg';
import PanesFig from '../../../assets/graphics/fig-panes.svg';
import StackFig from '../../../assets/graphics/fig-stack.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { IsoFigure, IsoLine } from '../graphics/IsoLineArt';

// Hover-driven motion for each email figure tile. Transforms use fill-box so
// SVG groups move in place; streaks loop only while hovered.
//
// Figures 0.1–0.3 are hand-authored SVGs whose moveable parts are addressed by
// id (see the matching asset in src/assets/graphics). Their translate values are
// in the source viewBox's user units, not screen px, so the numbers differ per
// figure: fig-stack/fig-panes are ~940–960 units tall rendered at ~128px, and
// fig-keyboard is 1544 units tall rendered at 144px. Roughly 75 / 110 units
// respectively buy the same ~10px of on-screen travel.
const emailFigHoverStyles = `
  .ef-part {
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .ef-fig #plate-top,
  .ef-fig #plate-middle,
  .ef-fig #plate-bottom,
  .ef-fig #node,
  .ef-fig #pane-right-upper,
  .ef-fig #pane-right-lower,
  .ef-fig #pane-left-upper,
  .ef-fig #pane-left-lower,
  .ef-fig #pedestal,
  .ef-fig #key-left-top,
  .ef-fig #key-right-top,
  .ef-fig #key-left-cap,
  .ef-fig #key-right-cap-a,
  .ef-fig #key-right-cap-b {
    transform-box: fill-box;
    transform-origin: center;
    transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  /* The keyboard's dashed links tie the floating keys to their caps. Both ends
     move on hover, so fade them rather than leave them hanging. */
  .ef-fig #key-left-link,
  .ef-fig #key-right-link-vert,
  .ef-fig #key-right-link-curve {
    transition: opacity 240ms ease-out;
  }
  /* Both dashed runs in fig-stack use a 2.5/2.5 cadence, so one four-period
     offset (20 units) loops seamlessly for the whole axis. */
  @keyframes efAxisFlow {
    to { stroke-dashoffset: 20; }
  }
  @keyframes efSpeedStreak {
    from { transform: translate(0, 0); opacity: var(--ef-streak-o, 0.5); }
    to { transform: translate(-20px, -10px); opacity: 0; }
  }
  @media (hover) {
    /* 0.1 — inboxes fan apart along the shared axis they stack on. */
    .email-fig-tile:hover .ef-fig--stack #plate-top { transform: translateY(-70px); }
    .email-fig-tile:hover .ef-fig--stack #plate-bottom { transform: translateY(60px); }
    .email-fig-tile:hover .ef-fig--stack .dash {
      animation: efAxisFlow 0.9s linear infinite;
    }
    /* 0.2 — each surface lifts out of the dashed slot it sits in. */
    .email-fig-tile:hover .ef-fig--panes #node { transform: translateY(-56px); }
    .email-fig-tile:hover .ef-fig--panes #pane-right-upper { transform: translate(52px, -20px); }
    .email-fig-tile:hover .ef-fig--panes #pane-right-lower { transform: translate(64px, 24px); }
    .email-fig-tile:hover .ef-fig--panes #pane-left-upper { transform: translate(-52px, -14px); }
    .email-fig-tile:hover .ef-fig--panes #pane-left-lower { transform: translate(-64px, 22px); }
    /* 0.3 — the shortcut keys pull off the deck. */
    .email-fig-tile:hover .ef-fig--keyboard #pedestal { transform: translateY(50px); }
    .email-fig-tile:hover .ef-fig--keyboard #key-left-top { transform: translate(-57px, -86px); }
    .email-fig-tile:hover .ef-fig--keyboard #key-right-top { transform: translate(61px, -103px); }
    .email-fig-tile:hover .ef-fig--keyboard #key-left-cap { transform: translate(-49px, 36px); }
    .email-fig-tile:hover .ef-fig--keyboard #key-right-cap-a { transform: translateY(28px); }
    .email-fig-tile:hover .ef-fig--keyboard #key-right-cap-b { transform: translate(57px, 45px); }
    .email-fig-tile:hover .ef-fig--keyboard #key-left-link,
    .email-fig-tile:hover .ef-fig--keyboard #key-right-link-vert,
    .email-fig-tile:hover .ef-fig--keyboard #key-right-link-curve {
      opacity: 0;
    }
    .email-fig-tile:hover .ef-speed-cube {
      transform: translate(7px, 3.5px);
      transition-duration: 260ms;
    }
    .email-fig-tile:hover .ef-speed-streak {
      animation: efSpeedStreak 0.42s linear infinite;
      transform-box: fill-box;
      transform-origin: center;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .ef-part, .ef-speed-cube, .ef-fig * { transition: none; }
    .ef-speed-streak, .ef-fig .dash { animation: none !important; }
  }
`;

// --- Figures ---------------------------------------------------------------
// Custom SVG line-art, sharing the same palette and stroke treatment.

function FigureSvg(props: { mobile: boolean; children: JSX.Element }) {
  return (
    <IsoFigure height={props.mobile ? '108px' : '128px'}>
      {props.children}
    </IsoFigure>
  );
}

function FigStack(props: { mobile: boolean }) {
  return (
    <StackFig
      class="ef-fig ef-fig--stack"
      style={{
        color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))',
        display: 'block',
        height: props.mobile ? '108px' : '128px',
        overflow: 'visible',
        width: 'auto',
      }}
    />
  );
}

function FigPanes(props: { mobile: boolean }) {
  return (
    <PanesFig
      class="ef-fig ef-fig--panes"
      style={{
        color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))',
        display: 'block',
        height: props.mobile ? '108px' : '128px',
        overflow: 'visible',
        width: 'auto',
      }}
    />
  );
}

function FigKeyboard(props: { mobile: boolean }) {
  return (
    <KeyboardFig
      class="ef-fig ef-fig--keyboard"
      style={{
        color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))',
        display: 'block',
        height: props.mobile ? '120px' : '144px',
        overflow: 'visible',
        width: 'auto',
      }}
    />
  );
}

function FigSpeed(props: { mobile: boolean }) {
  const band = { x: 74, y: 66 };
  const dx = 0.8944;
  const dy = 0.4472;
  const px = -0.4472;
  const py = 0.8944;
  const maxOffset = 48;
  const offsets = [9];
  for (let k = 1; k <= 19; k++) offsets.push(maxOffset * Math.pow(k / 19, 0.3));
  const lines: {
    from: { x: number; y: number };
    to: { x: number; y: number };
    opacity: number;
  }[] = [];
  let seed = 0;
  const hashRand = (n: number) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  offsets.forEach((offset) => {
    for (const side of [1, -1]) {
      if (hashRand(seed++) < 0.3) continue;
      const shift = (hashRand(seed++) - 0.5) * 150;
      const cx = band.x + side * offset * px + dx * shift;
      const cy = band.y + side * offset * py + dy * shift;
      const fwd = 2 + Math.pow(hashRand(seed++), 3.4) * 92;
      const back = 1 + Math.pow(hashRand(seed++), 3.4) * 64;
      lines.push({
        from: { x: cx - dx * back, y: cy - dy * back },
        to: { x: cx + dx * fwd, y: cy + dy * fwd },
        opacity: 0.42 + hashRand(seed++) * 0.22,
      });
    }
  });
  return (
    <div style={{ color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))' }}>
      <FigureSvg mobile={props.mobile}>
        <defs>
          <linearGradient
            id="speed-streak-fade"
            gradientUnits="userSpaceOnUse"
            x1="16"
            y1="26"
            x2="124"
            y2="80"
          >
            <stop offset="0" stop-color="#fff" stop-opacity="0" />
            <stop offset="0.24" stop-color="#fff" stop-opacity="1" />
            <stop offset="0.78" stop-color="#fff" stop-opacity="1" />
            <stop offset="1" stop-color="#fff" stop-opacity="0" />
          </linearGradient>
          <mask
            id="speed-streak-mask"
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="140"
            height="128"
          >
            <rect
              x="0"
              y="0"
              width="140"
              height="128"
              fill="url(#speed-streak-fade)"
            />
          </mask>
        </defs>
        <g mask="url(#speed-streak-mask)">
          <For each={lines}>
            {(line, i) => (
              <g
                class="ef-speed-streak"
                style={{
                  '--ef-streak-o': String(line.opacity),
                  'animation-delay': `${(i() * 0.018) % 0.38}s`,
                }}
              >
                <IsoLine from={line.from} to={line.to} opacity={line.opacity} />
              </g>
            )}
          </For>
        </g>
        <g class="ef-part ef-speed-cube">
          <g
            transform="translate(19 30) scale(.12) translate(-523 -459)"
            fill="color-mix(in srgb, color-mix(in srgb, currentColor 30%, var(--c1)) 11%, color-mix(in srgb, var(--b0) 85%, transparent))"
            stroke="currentColor"
            stroke-width=".9"
            stroke-linejoin="round"
            vector-effect="non-scaling-stroke"
          >
            <path
              vector-effect="non-scaling-stroke"
              d="M793.5 803c2.4 30.6 17.5 49.8 39.4 54.2l9.9.7 257 9.3-138.9-221.7-3.2-4.7c-12-13.6-30.2-18.4-51.4-12.6l-29.5 9.5c-2.4 1.2-4.9 2.5-7.4 3.9-44 25.4-79.6 87.1-79.6 137.8s0 3.4.1 5.1l3.6 18.5Z"
            />
            <path
              vector-effect="non-scaling-stroke"
              fill="none"
              opacity=".5"
              stroke-linecap="round"
              d="M876.5 642.2c-42.8 28.3-77.4 86.4-82.7 138.2"
            />
          </g>
        </g>
      </FigureSvg>
    </div>
  );
}

type Figure = {
  fig: string;
  title: string;
  subtext: string;
  Graphic: (props: { mobile: boolean }) => JSX.Element;
};

const figures: Figure[] = [
  {
    fig: 'Fig 0.1',
    title: 'All your accounts',
    subtext: 'Every inbox in one unified view.',
    Graphic: FigStack,
  },
  {
    fig: 'Fig 0.2',
    title: 'Not just email',
    subtext: 'Messages, docs, tasks, and calls.',
    Graphic: FigPanes,
  },
  {
    fig: 'Fig 0.3',
    title: 'Keyboard shortcuts',
    subtext: 'Triage hands-on-keyboard, no mouse.',
    Graphic: FigKeyboard,
  },
  {
    fig: 'Fig 0.4',
    title: 'Super fast',
    subtext: 'Instant search, send, and sync.',
    Graphic: FigSpeed,
  },
];

export function EmailFeatureFigures() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 920;

  return (
    <>
      <style>{emailFigHoverStyles}</style>
      <div
        style={{
          color: 'color-mix(in srgb, var(--a0) 34%, transparent)',
          display: 'grid',
          'grid-template-columns': mobile()
            ? 'minmax(0, 1fr)'
            : stacked()
              ? 'repeat(2, minmax(0, 1fr))'
              : 'repeat(4, minmax(0, 1fr))',
          width: '100%',
        }}
      >
        <For each={figures}>
          {(item, index) => (
            <div
              class="email-fig-tile"
              style={{
                'border-left':
                  !mobile() && (stacked() ? index() % 2 !== 0 : index() > 0)
                    ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                    : 'none',
                'border-top': (
                  mobile()
                    ? index() > 0
                    : stacked() && index() > 1
                )
                  ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                  : 'none',
                'box-sizing': 'border-box',
                display: 'grid',
                gap: mobile() ? '12px' : '26px',
                'grid-template-areas': mobile()
                  ? index() % 2 === 0
                    ? '"copy graphic"'
                    : '"graphic copy"'
                  : undefined,
                'grid-template-columns': mobile()
                  ? 'minmax(0, 1fr) minmax(0, 1fr)'
                  : undefined,
                'grid-template-rows': mobile() ? 'auto' : 'auto 1fr auto',
                'min-height': mobile() ? '150px' : undefined,
                padding: mobile() ? '18px' : '28px 30px',
              }}
            >
              <div
                style={{
                  'align-content': mobile() ? 'center' : undefined,
                  display: mobile() ? 'grid' : 'contents',
                  gap: mobile() ? '7px' : undefined,
                  'grid-area': mobile() ? 'copy' : undefined,
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
                    display: 'grid',
                    gap: mobile() ? '5px' : '6px',
                    'grid-row': mobile() ? undefined : 3,
                  }}
                >
                  <span
                    style={{
                      color: 'var(--c0)',
                      'font-family': 'body',
                      'font-size': mobile() ? '13px' : '14px',
                      'font-weight': '700',
                      'letter-spacing': '0.07em',
                      'text-transform': 'uppercase',
                    }}
                  >
                    {item.title}
                  </span>
                  <span
                    style={{
                      color: 'var(--c3)',
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
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  'grid-area': mobile() ? 'graphic' : undefined,
                  'grid-row': mobile() ? undefined : 2,
                  'justify-content': 'center',
                }}
              >
                <item.Graphic mobile={mobile()} />
              </div>
            </div>
          )}
        </For>
      </div>
    </>
  );
}
