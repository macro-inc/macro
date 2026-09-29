import { For, type JSX } from 'solid-js';
import AccountsFig from '../../../assets/graphics/fig-accounts.svg';
import KeyboardFig from '../../../assets/graphics/fig-keyboard.svg';
import SpeedFig from '../../../assets/graphics/fig-speed.svg';
import { viewportWidth } from '../../utils/utilBreakpoint';

// --- Figures ---------------------------------------------------------------
// Blender-rendered isometric line art for the /email page. Strokes are
// currentColor, so each picks up the grid's fig colour. Homepage keeps the
// smaller 1×4 IsoLineArt figures in EmailFeatureFigures.

function FigAccounts(props: { mobile: boolean }) {
  // Blender-rendered isometric line art (cards standing in an inbox box).
  // Strokes are currentColor, so it picks up the grid's fig colour.
  return (
    <AccountsFig
      style={{
        display: 'block',
        height: props.mobile ? '180px' : '240px',
        width: 'auto',
      }}
    />
  );
}

function FigKeyboard(props: { mobile: boolean }) {
  // Blender-rendered isometric line art (keycaps linked to floating shortcut
  // keys). Strokes are currentColor, so it picks up the grid's fig colour.
  return (
    <KeyboardFig
      style={{
        display: 'block',
        height: props.mobile ? '180px' : '240px',
        width: 'auto',
      }}
    />
  );
}

function FigSpeed(props: { mobile: boolean }) {
  // Blender-rendered line art (an exploded round streaking along its trajectory
  // axis). Strokes are currentColor, so it picks up the grid's fig colour. Wider
  // aspect than the other figs, so it's sized to fill the tile width.
  return (
    <SpeedFig
      style={{
        display: 'block',
        width: '100%',
        'max-width': props.mobile ? '280px' : '360px',
        height: 'auto',
      }}
    />
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
    Graphic: FigAccounts,
  },
  {
    fig: 'Fig 0.2',
    title: 'Keyboard shortcuts',
    subtext: 'Triage hands-on-keyboard, no mouse.',
    Graphic: FigKeyboard,
  },
  {
    fig: 'Fig 0.3',
    title: 'Super fast',
    subtext: 'Instant search, send, and sync.',
    Graphic: FigSpeed,
  },
];

export function EmailFeatureFiguresLarge() {
  const mobile = () => viewportWidth() < 700;

  return (
    <>
      <div
        style={{
          // Fully opaque so overlapping outer strokes (stacked tiles, crossing
          // cube edges) composite cleanly instead of stacking translucency into
          // a muddy blend — muted by mixing with grey rather than by alpha.
          color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))',
          display: 'grid',
          'grid-template-columns': mobile()
            ? 'minmax(0, 1fr)'
            : 'repeat(3, minmax(0, 1fr))',
          width: '100%',
        }}
      >
        <For each={figures}>
          {(item, index) => (
            <div
              class="email-fig-tile"
              style={{
                'border-left':
                  !mobile() && index() > 0
                    ? '1px solid color-mix(in srgb, var(--b4) 20%, transparent)'
                    : 'none',
                'border-top':
                  mobile() && index() > 0
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
                    'font-size': mobile() ? '15px' : '14px',
                    'font-weight': '700',
                    'letter-spacing': '0.07em',
                    'text-transform': 'uppercase',
                    'white-space': mobile() ? 'nowrap' : 'normal',
                  }}
                >
                  {item.title}
                </span>
                <span
                  style={{
                    color: mobile()
                      ? 'color-mix(in srgb, var(--c4) 70%, transparent)'
                      : 'color-mix(in srgb, var(--c4) 30%, transparent)',
                    'font-family': 'body',
                    'font-size': mobile() ? '14px' : '12.5px',
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
