import { For, type JSX, Show } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  InboxGraphic,
  MentionsGraphic,
} from '../featureGraphics/ChannelsGraphics';

type UiCell = {
  title: string;
  body: string;
  Graphic: () => JSX.Element;
};

// --- Spotlight composition helpers ------------------------------------------
// Dimmed mini-channel behind, a lifted popover element in front —
// mirrors the same composition used in DocumentsUiGrid.

const channelSurfaceL2 = '#0a0a0a';
const channelPanelBorder = 'color-mix(in srgb, var(--c4) 10%, transparent)';
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Compact mini-channel used as the dimmed backdrop for spotlights.
function MiniChannel() {
  const rows: { who: string; text: string; unread?: boolean; time: string }[] =
    [
      {
        who: 'Gabriel Birman',
        text: 'does anyone know why our posthog flags are broken?',
        unread: true,
        time: '4:20 PM',
      },
      { who: 'Rahul', text: 'which ones', time: '4:20 PM' },
      {
        who: 'Gabriel Birman',
        text: 'all of them, flags just return false',
        unread: true,
        time: '4:21 PM',
      },
      {
        who: 'Sean Wolf',
        text: '12 more replies · Last reply Today',
        time: '4:22 PM',
      },
      {
        who: 'Rahul',
        text: 'pushed a fix — flags resolve again',
        time: '4:38 PM',
      },
    ];
  return (
    <div
      style={{
        'background-color': channelSurfaceL2,
        border: `1px solid ${channelPanelBorder}`,
        'border-radius': '12px',
        'box-shadow': '0 22px 60px rgb(0 0 0 / 0.5)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        'text-align': 'left',
        width: 'min(420px, 100%)',
      }}
    >
      <div
        style={{
          'align-items': 'center',
          'border-bottom': `1px solid ${channelPanelBorder}`,
          display: 'flex',
          gap: '8px',
          padding: '11px 14px',
        }}
      >
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '12px',
            'font-weight': 600,
          }}
        >
          #
        </span>
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': '13.5px',
            'font-weight': 600,
          }}
        >
          bug-reports
        </span>
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '12px',
            'margin-left': 'auto',
          }}
        >
          Messages
        </span>
      </div>
      <For each={rows}>
        {(row, i) => (
          <div
            style={{
              'align-items': 'center',
              'border-bottom':
                i() === rows.length - 1
                  ? '0'
                  : `1px solid ${channelPanelBorder}`,
              display: 'flex',
              gap: '10px',
              padding: '9px 14px',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                'background-color': row.unread ? 'var(--c2)' : 'transparent',
                'border-radius': '999px',
                flex: 'none',
                height: '5px',
                width: '5px',
              }}
            />
            <span
              style={{
                color: row.unread ? 'var(--c1)' : 'var(--c4)',
                'font-family': appFont,
                'font-size': '13px',
                'font-weight': row.unread ? 600 : 400,
                'min-width': 0,
                overflow: 'hidden',
                'text-overflow': 'ellipsis',
                'white-space': 'nowrap',
                flex: 1,
              }}
            >
              <span style={{ color: 'var(--c2)', 'font-weight': 600 }}>
                {row.who}:
              </span>{' '}
              {row.text}
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '11px',
                'white-space': 'nowrap',
              }}
            >
              {row.time}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

const BACKDROP_FADE =
  'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)';
const STAGE_RADIAL =
  'radial-gradient(72% 72% at 50% 50%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)';

// Dimmed channel behind + lifted element in front (spotlight composition).
function SpotlightStage(props: { children: JSX.Element }) {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        position: 'relative',
        width: '100%',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          filter: 'saturate(0.85)',
          '-webkit-mask-image': BACKDROP_FADE,
          'mask-image': BACKDROP_FADE,
          opacity: '0.4',
          'pointer-events': 'none',
          width: '100%',
          display: 'grid',
          'justify-items': 'center',
        }}
      >
        <MiniChannel />
      </div>
      <div
        style={{
          'align-items': 'center',
          display: 'grid',
          inset: '0',
          'justify-items': 'center',
          position: 'absolute',
        }}
      >
        <div style={{ position: 'relative', width: 'min(320px, 100%)' }}>
          <div
            aria-hidden="true"
            style={{
              background: STAGE_RADIAL,
              inset: '-20% -16%',
              'pointer-events': 'none',
              position: 'absolute',
              'z-index': 0,
            }}
          />
          <div
            style={{
              filter: 'drop-shadow(0 30px 60px rgb(0 0 0 / 0.55))',
              position: 'relative',
              'z-index': 1,
            }}
          >
            {props.children}
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Quiet-by-default spotlight ----------------------------------------------
// The channel notification popover — the mechanics behind "quieter than
// Slack", which the threads/mention sections don't show.
function NotificationsSpotlight() {
  const options: { label: string; desc: string; active?: boolean }[] = [
    { label: 'All messages', desc: 'Every message pings you' },
    {
      label: 'Mentions only',
      desc: '@you and replies to your threads',
      active: true,
    },
    { label: 'Muted', desc: 'Catch up on your own time' },
  ];
  return (
    <SpotlightStage>
      <div
        style={{
          'background-color': 'var(--b1)',
          border: '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
          'border-radius': '12px',
          'box-shadow': '0 22px 60px rgb(0 0 0 / 0.5)',
          'box-sizing': 'border-box',
          overflow: 'hidden',
          'text-align': 'left',
          width: 'min(300px, 100%)',
        }}
      >
        <div
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '11.5px',
            'font-weight': 600,
            padding: '10px 14px 6px',
          }}
        >
          Notify me about…
        </div>
        <div style={{ display: 'grid', padding: '0 6px 6px' }}>
          <For each={options}>
            {(option) => (
              <div
                style={{
                  'align-items': 'center',
                  'background-color': option.active
                    ? 'color-mix(in srgb, var(--c1) 6%, transparent)'
                    : 'transparent',
                  'border-radius': '8px',
                  display: 'flex',
                  gap: '10px',
                  padding: '8px 8px',
                }}
              >
                <div style={{ display: 'grid', gap: '1px', 'min-width': 0 }}>
                  <span
                    style={{
                      color: 'var(--c1)',
                      'font-family': appFont,
                      'font-size': '13.5px',
                      'font-weight': option.active ? 600 : 400,
                    }}
                  >
                    {option.label}
                  </span>
                  <span
                    style={{
                      color: 'var(--c4)',
                      'font-family': appFont,
                      'font-size': '11.5px',
                    }}
                  >
                    {option.desc}
                  </span>
                </div>
                <Show when={option.active}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    style={{
                      display: 'block',
                      flex: 'none',
                      'margin-left': 'auto',
                    }}
                  >
                    <path
                      d="M5 12l4.5 4.5L19 7"
                      fill="none"
                      stroke="var(--a0)"
                      stroke-width="2.4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </SpotlightStage>
  );
}

// --- @mention sharing spotlight ----------------------------------------------
// An @mention share confirmation toast lifted over the dimmed channel.
function SharingSpotlight() {
  return (
    <SpotlightStage>
      <div
        style={{
          'align-items': 'center',
          'background-color': 'color-mix(in srgb, var(--b1) 92%, var(--b0))',
          border: `1px solid ${channelPanelBorder}`,
          'border-radius': '12px',
          'box-shadow': '0 22px 60px rgb(0 0 0 / 0.5)',
          'box-sizing': 'border-box',
          display: 'flex',
          gap: '11px',
          padding: '14px 16px',
          width: 'min(300px, 100%)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            'align-items': 'center',
            'background-color':
              'color-mix(in srgb, var(--c4) 18%, transparent)',
            'border-radius': '999px',
            color: 'var(--c2)',
            display: 'inline-flex',
            flex: 'none',
            height: '28px',
            'justify-content': 'center',
            width: '28px',
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            style={{ display: 'block' }}
          >
            <path
              d="M5 12l4.5 4.5L19 7"
              fill="none"
              stroke="var(--a0)"
              stroke-width="2.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <div style={{ display: 'grid', gap: '2px', 'min-width': 0 }}>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '13.5px',
              'font-weight': 600,
            }}
          >
            Shared to #go-to-market
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '12.5px',
            }}
          >
            Q3 launch plan · everyone now has access
          </span>
        </div>
      </div>
    </SpotlightStage>
  );
}

const cells: UiCell[] = [
  {
    title: 'Quiet by default',
    body: 'Follow a channel at mentions-only — the pings stop, and anything with your name still lands in your inbox.',
    Graphic: NotificationsSpotlight,
  },
  {
    title: '@mention anything',
    body: 'Pull any person, doc, task, or channel into a message with @. Each mention creates a two-way live link.',
    Graphic: MentionsGraphic,
  },
  {
    title: 'Channel-based sharing',
    body: '@mention a file and every channel member gets access automatically — no more "can you share that with me?"',
    Graphic: SharingSpotlight,
  },
  {
    title: 'One inbox',
    body: 'Channel mentions, email, and tasks all land in one Signal-filtered inbox — nothing falls through the cracks.',
    Graphic: InboxGraphic,
  },
];

const GRAPHIC_FADE =
  'linear-gradient(to bottom, #000 0%, #000 76%, transparent 100%)';

export function ChannelsUiGrid() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 860;
  const cols = () => (stacked() ? 1 : 2);

  return (
    <section
      aria-label="In every channel"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        class="channels-ui-grid"
        style={{
          border: '1px solid color-mix(in srgb, var(--b4) 16%, transparent)',
          'border-radius': mobile() ? '16px' : '20px',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': stacked()
            ? '1fr'
            : 'repeat(2, minmax(0, 1fr))',
          'max-width': '1080px',
          overflow: 'hidden',
          width: '100%',
        }}
      >
        <For each={cells}>
          {(cell, index) => (
            <div
              style={{
                'border-left':
                  index() % cols() !== 0
                    ? '1px solid color-mix(in srgb, var(--b4) 14%, transparent)'
                    : 'none',
                'border-top':
                  index() >= cols()
                    ? '1px solid color-mix(in srgb, var(--b4) 14%, transparent)'
                    : 'none',
                'box-sizing': 'border-box',
                display: 'grid',
                'grid-template-rows': '1fr auto',
              }}
            >
              <div
                style={{
                  'align-items': 'center',
                  display: 'grid',
                  'justify-items': 'center',
                  'min-height': mobile() ? '0' : '300px',
                  overflow: 'hidden',
                  padding: mobile() ? '24px 18px 0' : '32px 24px 0',
                  position: 'relative',
                  width: '100%',
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    background:
                      'radial-gradient(58% 54% at 50% 42%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)',
                    inset: '0',
                    'pointer-events': 'none',
                    position: 'absolute',
                  }}
                />
                <div
                  style={{
                    display: 'grid',
                    'justify-items': 'center',
                    '-webkit-mask-image': GRAPHIC_FADE,
                    'mask-image': GRAPHIC_FADE,
                    position: 'relative',
                    width: '100%',
                  }}
                >
                  <cell.Graphic />
                </div>
              </div>
              <div
                style={{
                  display: 'grid',
                  gap: mobile() ? '8px' : '10px',
                  padding: mobile() ? '18px 22px 30px' : '22px 34px 36px',
                }}
              >
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
                  {cell.title}
                </h3>
                <p
                  style={{
                    color: 'var(--c4)',
                    'font-family': 'body',
                    'font-size': mobile() ? '15px' : '16px',
                    'font-weight': '400',
                    'line-height': 1.5,
                    margin: 0,
                    'max-width': '420px',
                  }}
                >
                  {cell.body}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>
    </section>
  );
}
