import { For, type JSX } from 'solid-js';
import { viewportWidth } from '../../utils/utilBreakpoint';
import { SearchGraphic } from '../featureGraphics/CallsGraphics';

type UiCell = {
  title: string;
  body: string;
  Graphic: () => JSX.Element;
};

// Linear-style near-black surface stack above the page bg (--b0). Grayscale
// surfaces with a single orange (--a0) accent per mock, matching the email and
// docs 2×2 grids.
const surfaceL2 = '#0a0a0a';
const panelBorder = 'color-mix(in srgb, var(--c4) 12%, transparent)';
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function CardShell(props: { children: JSX.Element; width?: string }) {
  return (
    <div
      style={{
        'background-color': surfaceL2,
        border: `1px solid ${panelBorder}`,
        'border-radius': '12px',
        'box-shadow': '0 22px 60px rgb(0 0 0 / 0.5)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        'text-align': 'left',
        width: props.width ?? 'min(320px, 100%)',
      }}
    >
      {props.children}
    </div>
  );
}

function PhoneGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 14;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4z"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="1.6"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function PlayGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path d="M8 5.5l11 6.5-11 6.5z" fill={props.color ?? 'currentColor'} />
    </svg>
  );
}

function CheckGlyph(props: { size?: number; color?: string }) {
  const s = props.size ?? 12;
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', flex: 'none' }}
    >
      <path
        d="M5 12l4.5 4.5L19 7"
        fill="none"
        stroke={props.color ?? 'currentColor'}
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

function Avatar(props: { initials: string; size?: number }) {
  const s = props.size ?? 22;
  return (
    <span
      aria-hidden="true"
      style={{
        'align-items': 'center',
        'background-color': 'var(--b3)',
        border: '1px solid color-mix(in srgb, var(--c4) 10%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        display: 'inline-grid',
        flex: 'none',
        'font-family': appFont,
        'font-size': `${Math.round(s * 0.4)}px`,
        'font-weight': '600',
        height: `${s}px`,
        'place-items': 'center',
        width: `${s}px`,
      }}
    >
      {props.initials}
    </span>
  );
}

// --- A compact, dimmable calls list used as the spotlight backdrop ----------
const miniCalls: {
  title: string;
  dur: string;
  time: string;
  unread?: boolean;
}[] = [
  { title: 'Engineering Standup', dur: '7m 59s', time: '9:05', unread: true },
  { title: 'Settings UI Overhaul', dur: '9m 37s', time: 'Jun 15' },
  {
    title: 'Sprint Update: Multi-Inbox',
    dur: '16m 25s',
    time: 'Jun 16',
    unread: true,
  },
  { title: 'Engineers Weekly Sync', dur: '9m 29s', time: 'Jun 9' },
  { title: 'CRM Search & Deploys', dur: '8m 30s', time: 'Jun 8' },
];

function MiniCalls() {
  return (
    <CardShell width="min(420px, 100%)">
      <div
        style={{
          'align-items': 'center',
          'border-bottom': `1px solid ${panelBorder}`,
          display: 'flex',
          gap: '8px',
          padding: '11px 14px',
        }}
      >
        <span
          style={{
            color: 'var(--c1)',
            'font-family': appFont,
            'font-size': '13.5px',
            'font-weight': 600,
          }}
        >
          Calls
        </span>
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '12px',
            'margin-left': 'auto',
          }}
        >
          All
        </span>
      </div>
      <For each={miniCalls}>
        {(row, i) => (
          <div
            style={{
              'align-items': 'center',
              'border-bottom':
                i() === miniCalls.length - 1 ? '0' : `1px solid ${panelBorder}`,
              display: 'grid',
              gap: '10px',
              'grid-template-columns': 'auto auto minmax(0, 1fr) auto',
              padding: '10px 14px',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                'background-color': row.unread ? 'var(--c2)' : 'transparent',
                'border-radius': '999px',
                flex: 'none',
                height: '6px',
                width: '6px',
              }}
            />
            <PhoneGlyph size={14} color="var(--c4)" />
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
              }}
            >
              {row.title}
              <span style={{ color: 'var(--c4)', 'font-weight': 400 }}>
                {' '}
                {row.dur}
              </span>
            </span>
            <span
              style={{
                color: 'var(--c4)',
                'font-family': appFont,
                'font-size': '11.5px',
                'white-space': 'nowrap',
              }}
            >
              {row.time}
            </span>
          </div>
        )}
      </For>
    </CardShell>
  );
}

const BACKDROP_FADE =
  'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)';
const STAGE_RADIAL =
  'radial-gradient(72% 72% at 50% 50%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)';

// Dimmed calls list behind, a single element lifted and spotlit in front — the
// same composition as the email/docs 2×2 spotlights.
function SpotlightStage(props: { children: JSX.Element; width?: string }) {
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
          opacity: '0.42',
          'pointer-events': 'none',
          width: '100%',
        }}
      >
        <MiniCalls />
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
        <div
          style={{
            position: 'relative',
            width: props.width ?? 'min(320px, 100%)',
          }}
        >
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
              filter: 'drop-shadow(0 40px 80px rgb(0 0 0 / 0.55))',
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

// --- Transcript card, lifted over the calls list ----------------------------
const transcriptRows = [
  {
    who: 'Evan Decker',
    initials: 'ED',
    time: '2:14',
    text: "I'm taking the email bugs this week.",
    accent: true,
  },
  {
    who: 'Teo Nys',
    initials: 'TN',
    time: '2:31',
    text: "I'll keep pushing on multi-inbox and CRM search.",
  },
];

function TranscriptCard() {
  return (
    <CardShell width="min(340px, 100%)">
      <div
        style={{
          'align-items': 'center',
          'border-bottom': `1px solid ${panelBorder}`,
          display: 'flex',
          gap: '9px',
          padding: '10px 14px',
        }}
      >
        <span
          style={{
            'align-items': 'center',
            'background-color': 'var(--a0)',
            'border-radius': '999px',
            color: 'var(--b0)',
            display: 'inline-flex',
            flex: 'none',
            height: '20px',
            'justify-content': 'center',
            'padding-left': '2px',
            width: '20px',
          }}
        >
          <PlayGlyph size={11} color="var(--b0)" />
        </span>
        <span
          aria-hidden="true"
          style={{
            'background-color': 'var(--b3)',
            'border-radius': '999px',
            flex: 1,
            height: '4px',
            position: 'relative',
          }}
        >
          <span
            style={{
              'background-color': 'var(--c2)',
              'border-radius': '999px',
              height: '100%',
              left: 0,
              position: 'absolute',
              width: '34%',
            }}
          />
        </span>
        <span
          style={{
            color: 'var(--c4)',
            'font-family': appFont,
            'font-size': '11px',
            'white-space': 'nowrap',
          }}
        >
          2:42 / 7:59
        </span>
      </div>
      <div style={{ display: 'grid', gap: '13px', padding: '14px' }}>
        <For each={transcriptRows}>
          {(row) => (
            <div
              style={{
                'align-items': 'flex-start',
                'background-color': row.accent
                  ? 'color-mix(in srgb, var(--a0) 7%, transparent)'
                  : 'transparent',
                'border-radius': '8px',
                display: 'flex',
                gap: '10px',
                margin: row.accent ? '0 -8px' : '0',
                padding: row.accent ? '8px' : '0',
              }}
            >
              <Avatar initials={row.initials} size={24} />
              <div style={{ display: 'grid', gap: '3px', 'min-width': 0 }}>
                <div
                  style={{
                    'align-items': 'center',
                    display: 'flex',
                    gap: '8px',
                  }}
                >
                  <span
                    style={{
                      color: 'var(--c1)',
                      'font-family': appFont,
                      'font-size': '12.5px',
                      'font-weight': 600,
                    }}
                  >
                    {row.who}
                  </span>
                  <span
                    style={{
                      color: 'var(--c4)',
                      'font-family': appFont,
                      'font-size': '11px',
                      'margin-left': 'auto',
                    }}
                  >
                    {row.time}
                  </span>
                </div>
                <p
                  style={{
                    color: 'var(--c2)',
                    'font-family': appFont,
                    'font-size': '13px',
                    'line-height': 1.5,
                    margin: 0,
                  }}
                >
                  {row.text}
                </p>
              </div>
            </div>
          )}
        </For>
      </div>
    </CardShell>
  );
}

function TranscriptSpotlight() {
  return (
    <SpotlightStage width="min(340px, 100%)">
      <TranscriptCard />
    </SpotlightStage>
  );
}

// --- AI summary card, lifted over the calls list ----------------------------
function SummaryCard() {
  return (
    <CardShell width="min(340px, 100%)">
      <div style={{ display: 'grid', gap: '13px', padding: '16px 18px' }}>
        <div style={{ display: 'grid', gap: '5px' }}>
          <span
            style={{
              color: 'var(--c1)',
              'font-family': appFont,
              'font-size': '15px',
              'font-weight': 600,
              'line-height': 1.25,
            }}
          >
            Settings UI Overhaul
          </span>
          <span
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '12px',
            }}
          >
            Jun 10 · 9m 37s
          </span>
        </div>
        <div style={{ display: 'grid', gap: '8px' }}>
          <span
            style={{
              'align-items': 'center',
              color: 'var(--a0)',
              display: 'inline-flex',
              'font-family': "'rajdhani', body",
              'font-size': '11px',
              'font-weight': 700,
              gap: '6px',
              'letter-spacing': '0.08em',
              'text-transform': 'uppercase',
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              aria-hidden="true"
              style={{ display: 'block' }}
            >
              <path
                d="M12 5c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7z"
                fill="currentColor"
              />
            </svg>
            AI Summary
          </span>
          <p
            style={{
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': '13px',
              'line-height': 1.55,
              margin: 0,
            }}
          >
            The team agreed to move settings to a left-sidebar layout, modal by
            default. <span style={{ color: 'var(--c1)' }}>Aidan owns it.</span>
          </p>
        </div>
        <div
          style={{
            'align-items': 'center',
            'background-color': 'var(--b0)',
            border: `1px solid ${panelBorder}`,
            'border-radius': '8px',
            display: 'flex',
            gap: '8px',
            padding: '9px 11px',
          }}
        >
          <span
            style={{
              'align-items': 'center',
              'background-color':
                'color-mix(in srgb, var(--a0) 16%, transparent)',
              'border-radius': '5px',
              color: 'var(--a0)',
              display: 'inline-flex',
              flex: 'none',
              height: '20px',
              'justify-content': 'center',
              width: '20px',
            }}
          >
            <CheckGlyph size={12} color="var(--a0)" />
          </span>
          <span
            style={{
              color: 'var(--c2)',
              'font-family': appFont,
              'font-size': '12.5px',
            }}
          >
            Owner
          </span>
          <span
            style={{
              'align-items': 'center',
              color: 'var(--c1)',
              display: 'inline-flex',
              'font-family': appFont,
              'font-size': '12.5px',
              gap: '6px',
              'margin-left': 'auto',
            }}
          >
            <Avatar initials="AH" size={18} /> Aidan
          </span>
        </div>
      </div>
    </CardShell>
  );
}

function SummarySpotlight() {
  return (
    <SpotlightStage width="min(340px, 100%)">
      <SummaryCard />
    </SpotlightStage>
  );
}

// --- Sharing toggle mock (own card, single orange accent) -------------------
function SharingMock() {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '12px',
        'justify-items': 'center',
        padding: '8px 0',
        width: '100%',
      }}
    >
      <CardShell width="min(360px, 100%)">
        <div style={{ display: 'grid', gap: '12px', padding: '16px' }}>
          <div
            style={{ 'align-items': 'center', display: 'flex', gap: '11px' }}
          >
            <span
              style={{
                'align-items': 'center',
                'background-color': 'var(--a0)',
                'border-radius': '6px',
                color: 'var(--b0)',
                display: 'inline-flex',
                flex: 'none',
                height: '22px',
                'justify-content': 'center',
                width: '22px',
              }}
            >
              <CheckGlyph size={13} color="var(--b0)" />
            </span>
            <span
              style={{
                color: 'var(--c1)',
                'font-family': appFont,
                'font-size': '14px',
                'font-weight': 600,
              }}
            >
              Share with team
            </span>
            <span
              style={{
                'align-items': 'center',
                display: 'inline-flex',
                'margin-left': 'auto',
              }}
            >
              <For each={['JB', 'TN', 'HU']}>
                {(p, i) => (
                  <span
                    style={{
                      'border-radius': '999px',
                      'box-shadow': '0 0 0 2px ' + surfaceL2,
                      display: 'inline-flex',
                      'margin-left': i() === 0 ? '0' : '-7px',
                    }}
                  >
                    <Avatar initials={p} size={20} />
                  </span>
                )}
              </For>
            </span>
          </div>
          <p
            style={{
              color: 'var(--c4)',
              'font-family': appFont,
              'font-size': '12.5px',
              'line-height': 1.5,
              margin: 0,
            }}
          >
            Everyone on your team can view and search this call, and your agents
            get its context.
          </p>
        </div>
      </CardShell>
    </div>
  );
}

// --- Search card (reuse the page's SearchGraphic) ---------------------------
function SearchMock() {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        padding: '8px 0',
        width: '100%',
      }}
    >
      <div style={{ width: 'min(380px, 100%)' }}>
        <SearchGraphic />
      </div>
    </div>
  );
}

const cells: UiCell[] = [
  {
    title: 'Speaker-attributed transcript',
    body: 'A readable, speaker-labeled transcript and recording, ready the moment a call ends.',
    Graphic: TranscriptSpotlight,
  },
  {
    title: 'AI summary & owners',
    body: 'A crisp summary with decisions, owners, and next steps written up for every call.',
    Graphic: SummarySpotlight,
  },
  {
    title: 'Ask across every call',
    body: 'Ask AI a question and get an answer cited straight to the moments it came from.',
    Graphic: SearchMock,
  },
  {
    title: 'Share or keep private',
    body: 'Share each call to team memory by default, or opt out per call to keep it yours.',
    Graphic: SharingMock,
  },
];

// The graphic floats above a soft glow and fades into the cell at the bottom,
// matching the email/docs 2×2 grids.
const GRAPHIC_FADE =
  'linear-gradient(to bottom, #000 0%, #000 76%, transparent 100%)';

export function CallsUiGrid() {
  const mobile = () => viewportWidth() < 700;
  const stacked = () => viewportWidth() < 860;
  const cols = () => (stacked() ? 1 : 2);

  return (
    <section
      aria-label="In every call"
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
        class="calls-ui-grid"
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
