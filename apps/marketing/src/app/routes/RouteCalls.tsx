import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import {
  AgentContextGraphic,
  CallStageGraphic,
  SummaryGraphic,
  TranscriptGraphic,
} from '../components/featureGraphics/CallsGraphics';
import { CallsFeatureGrid } from '../components/sections/CallsFeatureGrid';
import { CallsUiGrid } from '../components/sections/CallsUiGrid';
import {
  HomeAppPreview,
  HomeHeroBackdrop,
} from '../components/sections/HomeAppPreview';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import {
  type LoopsFeatureBlock,
  LoopsFeatureSection,
  loopsFeatureHoverStyles,
} from '../components/sections/LoopsFeatureSection';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { viewportWidth } from '../utils/utilBreakpoint';
import { CtaIcon, ctaHref, ctaLabel, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';

const HERO_DEMO_VIDEO_ID = 'MMG00RA7kU0'; // "Calls on Macro"

const mobile = () => viewportWidth() < 700;

// ---------------------------------------------------------------------------
// CTAs
// ---------------------------------------------------------------------------

function ConnectGoogleButton(props: { buttonName: string; large?: boolean }) {
  return (
    <a
      href={ctaHref()}
      class="calls-cta-button"
      onClick={(event) => handleCtaClick(event, props.buttonName)}
      style={{
        'align-items': 'center',
        'background-color': 'var(--a0)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--b0)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': mobile() ? '15px' : props.large ? '18px' : '16px',
        'font-weight': '700',
        gap: '8px',
        height: mobile() ? '40px' : props.large ? '46px' : '40px',
        'justify-content': 'center',
        'letter-spacing': '0.045em',
        'line-height': 1,
        overflow: 'hidden',
        padding: mobile() ? '0 20px' : props.large ? '0 28px' : '0 22px',
        'text-decoration': 'none',
        'text-transform': 'uppercase',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
        width: mobile() ? '100%' : 'max-content',
      }}
    >
      <CtaIcon size={mobile() ? 16 : 15} />
      {ctaLabel('Connect with Google')}
    </a>
  );
}

function WatchDemoButton(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Watch demo video"
      class="calls-cta-button"
      onClick={props.onClick}
      style={{
        'align-items': 'center',
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'pointer',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': mobile() ? '15px' : '16px',
        'font-weight': '700',
        gap: '9px',
        height: mobile() ? '40px' : '40px',
        'justify-content': 'center',
        'letter-spacing': '0.045em',
        'line-height': 1,
        padding: '0 20px',
        'text-transform': 'uppercase',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
        width: mobile() ? '100%' : 'max-content',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          'border-bottom': '5px solid transparent',
          'border-left': '8px solid var(--a0)',
          'border-top': '5px solid transparent',
          display: 'block',
          height: '0',
          width: '0',
        }}
      />
      Watch Demo
    </button>
  );
}

// ---------------------------------------------------------------------------
// Spotlight compositions — a dimmed full window behind, one element lifted and
// spotlit in front (mirrors the email/docs page spotlights).
// ---------------------------------------------------------------------------

// "Every call, summarized" — the transcript window dimmed behind, the AI summary
// card lifted and spotlit in front.
function SummarySpotlightShot() {
  const compact = () => mobile();
  return (
    <Show
      when={!compact()}
      fallback={
        <div
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            'justify-items': 'center',
            width: '100%',
          }}
        >
          <SummaryGraphic />
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          position: 'relative',
          width: '100%',
        }}
      >
        {/* Dimmed transcript window behind */}
        <div
          aria-hidden="true"
          style={{
            filter: 'saturate(0.85)',
            'mask-image':
              'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
            '-webkit-mask-image':
              'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
            opacity: '0.42',
            'pointer-events': 'none',
            width: '100%',
          }}
        >
          <TranscriptGraphic />
        </div>
        {/* Lifted summary card, spotlit in front */}
        <div
          style={{
            'align-items': 'center',
            display: 'grid',
            inset: '0',
            'justify-items': 'center',
            position: 'absolute',
          }}
        >
          <div style={{ position: 'relative', width: 'min(480px, 100%)' }}>
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(70% 70% at 50% 50%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 72%)',
                inset: '-14% -10%',
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
              <SummaryGraphic />
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}

// "Your agents were there" — the summary window dimmed behind, the agent phone
// lifted and spotlit in front (mirrors EmailAiSpotlight).
function AgentSpotlightShot() {
  const compact = () => mobile();
  return (
    <Show
      when={!compact()}
      fallback={
        <div
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            'justify-items': 'center',
            width: '100%',
          }}
        >
          <AgentContextGraphic />
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          position: 'relative',
          width: '100%',
        }}
      >
        {/* Dimmed summary window, centered behind the phone */}
        <div
          aria-hidden="true"
          style={{
            'align-items': 'center',
            display: 'grid',
            inset: '0',
            'justify-items': 'center',
            'pointer-events': 'none',
            position: 'absolute',
          }}
        >
          <div
            style={{
              filter: 'saturate(0.85)',
              'mask-image':
                'radial-gradient(120% 92% at 50% 50%, #000 28%, transparent 78%)',
              '-webkit-mask-image':
                'radial-gradient(120% 92% at 50% 50%, #000 28%, transparent 78%)',
              'max-width': '760px',
              opacity: '0.3',
              width: '100%',
            }}
          >
            <SummaryGraphic />
          </div>
        </div>
        {/* The agent phone, lifted and spotlit in front */}
        <div style={{ position: 'relative', 'z-index': 1 }}>
          <div
            aria-hidden="true"
            style={{
              background:
                'radial-gradient(58% 58% at 50% 46%, color-mix(in srgb, var(--ambient-ink) 9%, transparent) 0%, transparent 72%)',
              inset: '-10% -55%',
              'pointer-events': 'none',
              position: 'absolute',
              'z-index': 0,
            }}
          />
          <div
            style={{
              filter: 'drop-shadow(0 44px 86px rgb(0 0 0 / 0.6))',
              position: 'relative',
              'z-index': 1,
            }}
          >
            <AgentContextGraphic />
          </div>
        </div>
      </div>
    </Show>
  );
}

// "On the call" — one full, bright in-call window (the call stage is its own
// complete surface, so no dimmed backdrop is needed).
function CallStageShot() {
  return (
    <div
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        width: '100%',
      }}
    >
      <CallStageGraphic />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Split spotlight section blocks
// ---------------------------------------------------------------------------

const summaryBlock: LoopsFeatureBlock = {
  label: 'Calls',
  headline: (
    <>
      Every call,
      <br />
      written up.
    </>
  ),
  description:
    'The moment a call ends you get a speaker-attributed transcript and an AI summary with every decision and owner.',
  href: 'https://docs.macro.com/product/calls',
  heroShot: SummarySpotlightShot,
  heroBare: true,
};

const stageBlock: LoopsFeatureBlock = {
  label: 'Calls',
  headline: (
    <>
      On the call,
      <br />
      taking notes.
    </>
  ),
  description:
    'Host or join right inside Macro. It records, transcribes, and writes meeting notes live while you talk.',
  href: 'https://docs.macro.com/product/calls',
  heroShot: CallStageShot,
  heroBare: true,
};

const agentBlock: LoopsFeatureBlock = {
  label: 'Calls',
  headline: (
    <>
      Your agents
      <br />
      were there.
    </>
  ),
  description:
    'Agents read the calls you share, so they can act on what was said — assign a bug to whoever owned it in the standup.',
  href: 'https://docs.macro.com/product/calls',
  heroShot: AgentSpotlightShot,
  heroBare: true,
};

// ---------------------------------------------------------------------------
// Comparison table (Macro vs Zoom vs Google Meet vs Granola)
// ---------------------------------------------------------------------------

type Cell = boolean | 'partial' | string;

const comparisonColumns = ['Macro', 'Zoom', 'Meet', 'Granola'];

const comparisonRows: { feature: string; cells: [Cell, Cell, Cell, Cell] }[] = [
  { feature: 'Host & join video calls', cells: [true, true, true, false] },
  {
    feature: 'Auto transcript with speaker labels',
    cells: [true, 'partial', 'partial', true],
  },
  {
    feature: 'AI summary after every call',
    cells: [true, 'partial', 'partial', true],
  },
  {
    feature: 'Searchable transcript archive',
    cells: [true, 'partial', false, true],
  },
  {
    feature: 'Calls auto-saved to team memory',
    cells: [true, false, false, 'partial'],
  },
  {
    feature: 'Agents with full call + workspace context',
    cells: [true, false, false, false],
  },
  {
    feature: 'Per-call privacy / opt-out of sharing',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  {
    feature: 'Lives with your email, docs, tasks & chat',
    cells: [true, false, 'partial', false],
  },
  {
    feature: 'Ask AI across all your calls',
    cells: [true, false, false, 'partial'],
  },
  { feature: 'Open source (AGPLv3)', cells: [true, false, false, false] },
  { feature: 'Price / seat / month', cells: ['$40', '$16', '$7', '$18'] },
];

function CheckMark() {
  return (
    <svg
      width="16"
      height="13"
      viewBox="0 0 16 13"
      aria-label="Yes"
      role="img"
      style={{ display: 'block' }}
    >
      <path
        d="M1.5 6.5 L5.8 11 L14.5 1.6"
        fill="none"
        stroke="var(--a0)"
        stroke-width="2.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
function PartialMark() {
  return (
    <span
      aria-label="Partial"
      role="img"
      style={{
        'background-color': 'color-mix(in srgb, var(--c4) 55%, transparent)',
        'border-radius': '999px',
        display: 'block',
        height: '4px',
        width: '14px',
      }}
    />
  );
}
function CrossMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 13 13"
      aria-label="No"
      role="img"
      style={{ display: 'block', opacity: 0.45 }}
    >
      <path
        d="M2 2 L11 11 M11 2 L2 11"
        fill="none"
        stroke="var(--c4)"
        stroke-width="1.8"
        stroke-linecap="round"
      />
    </svg>
  );
}

function ComparisonCell(props: { value: Cell; macro: boolean }) {
  const isPrice = () =>
    typeof props.value === 'string' && props.value !== 'partial';
  return (
    <div
      style={{
        'align-items': 'center',
        display: 'flex',
        'justify-content': 'center',
        'min-height': '22px',
      }}
    >
      <Show
        when={isPrice()}
        fallback={
          <Show
            when={props.value === true}
            fallback={
              <Show when={props.value === 'partial'} fallback={<CrossMark />}>
                <PartialMark />
              </Show>
            }
          >
            <CheckMark />
          </Show>
        }
      >
        <span
          style={{
            color: props.macro ? 'var(--a0)' : 'var(--c2)',
            'font-family': 'rajdhani, body',
            'font-size': mobile() ? '13px' : '15px',
            'font-weight': '700',
            'letter-spacing': '0.02em',
            'white-space': 'nowrap',
          }}
        >
          {props.value as string}
        </span>
      </Show>
    </div>
  );
}

function ComparisonTable() {
  const gridTemplate = () =>
    mobile()
      ? 'minmax(150px, 1.5fr) repeat(4, minmax(52px, 1fr))'
      : 'minmax(0, 2.2fr) repeat(4, minmax(0, 1fr))';

  const headerCellStyle = (macro: boolean): JSX.CSSProperties => ({
    'align-items': 'center',
    'background-color': macro
      ? 'color-mix(in srgb, var(--a0) 12%, var(--b0))'
      : 'transparent',
    color: macro ? 'var(--a0)' : 'var(--c2)',
    display: 'flex',
    'font-family': 'rajdhani, body',
    'font-size': mobile() ? '12px' : '15px',
    'font-weight': '700',
    'justify-content': 'center',
    'letter-spacing': '0.04em',
    'line-height': 1.1,
    padding: mobile() ? '14px 6px' : '18px 12px',
    'text-align': 'center',
    'text-transform': 'uppercase',
  });

  return (
    <div
      style={{
        'overflow-x': mobile() ? 'auto' : 'visible',
        width: '100%',
        'min-width': '0',
        'max-width': '100%',
        '-webkit-overflow-scrolling': 'touch',
      }}
    >
      <div
        style={{
          border: '1px solid var(--b2)',
          'box-sizing': 'border-box',
          display: 'grid',
          'grid-template-columns': gridTemplate(),
          'min-width': mobile() ? '500px' : 'auto',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            'background-color': 'var(--b0)',
            'border-bottom': '1px solid var(--b2)',
          }}
        />
        <For each={comparisonColumns}>
          {(col, index) => (
            <div
              style={{
                ...headerCellStyle(index() === 0),
                'border-bottom':
                  index() === 0 ? '1px solid var(--a0)' : '1px solid var(--b2)',
              }}
            >
              {col}
            </div>
          )}
        </For>

        <For each={comparisonRows}>
          {(row, rowIndex) => (
            <>
              <div
                style={{
                  'align-items': 'center',
                  'background-color': 'var(--b0)',
                  'border-bottom':
                    rowIndex() === comparisonRows.length - 1
                      ? '0'
                      : '1px solid var(--b2)',
                  color: 'var(--c2)',
                  display: 'flex',
                  'font-size': mobile() ? '13px' : '16px',
                  'line-height': 1.25,
                  padding: mobile() ? '13px 12px 13px 14px' : '15px 20px',
                  position: mobile() ? 'sticky' : 'static',
                  left: mobile() ? '0' : 'auto',
                  'z-index': mobile() ? 1 : 'auto',
                }}
              >
                {row.feature}
              </div>
              <For each={row.cells}>
                {(cell, cellIndex) => (
                  <div
                    style={{
                      'align-items': 'center',
                      'background-color':
                        cellIndex() === 0
                          ? 'color-mix(in srgb, var(--a0) 7%, var(--b0))'
                          : 'var(--b0)',
                      'border-bottom':
                        rowIndex() === comparisonRows.length - 1
                          ? '0'
                          : '1px solid var(--b2)',
                      'border-left':
                        cellIndex() === 0
                          ? '1px solid color-mix(in srgb, var(--a0) 28%, transparent)'
                          : '0',
                      'border-right':
                        cellIndex() === 0
                          ? '1px solid color-mix(in srgb, var(--a0) 28%, transparent)'
                          : '0',
                      display: 'flex',
                      'justify-content': 'center',
                      padding: mobile() ? '13px 6px' : '15px 12px',
                    }}
                  >
                    <ComparisonCell value={cell} macro={cellIndex() === 0} />
                  </div>
                )}
              </For>
            </>
          )}
        </For>
      </div>
    </div>
  );
}

function ComparisonSection() {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <section
      aria-label="How Macro Calls compares"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '28px' : '40px',
        'justify-items': 'center',
        'min-width': '0',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: '14px',
          'justify-items': 'center',
          'max-width': '720px',
          'text-align': 'center',
        }}
      >
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'rajdhani, body',
            'font-size': mobile() ? '12px' : '16px',
            'letter-spacing': '0.08em',
            'text-transform': 'uppercase',
          }}
        >
          The comparison
        </span>
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': mobile() ? '32px' : '44px',
            'font-weight': '410',
            'letter-spacing': '-0.015em',
            'line-height': 1.1,
            margin: 0,
          }}
        >
          More than a video call.
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-size': mobile() ? '16px' : '19px',
            'line-height': 1.45,
            margin: 0,
            'max-width': '560px',
          }}
        >
          Zoom hosts the call and forgets it. Macro records, transcribes, and
          remembers every call.
        </p>
      </div>
      <div
        style={{
          width: '100%',
          'max-width': '920px',
          'min-width': '0',
          position: 'relative',
        }}
      >
        <div
          style={{
            'max-height': expanded() ? 'none' : mobile() ? '320px' : '420px',
            overflow: 'hidden',
          }}
        >
          <ComparisonTable />
        </div>
        <Show when={!expanded()}>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            style={{
              'align-items': 'flex-end',
              background:
                'linear-gradient(to bottom, transparent 0, var(--b0) 82%)',
              border: '0',
              bottom: '0',
              cursor: 'pointer',
              display: 'flex',
              height: '120px',
              'justify-content': 'center',
              left: '0',
              padding: '0 0 12px',
              position: 'absolute',
              right: '0',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                color: 'var(--c4)',
                display: 'flex',
                'font-family': "'rajdhani', body",
                'font-size': '11px',
                'font-weight': '700',
                gap: '8px',
                'letter-spacing': '0.1em',
                'text-transform': 'uppercase',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  background: 'var(--b3)',
                  height: '1px',
                  width: '20px',
                }}
              />
              Show more
              <span
                aria-hidden="true"
                style={{
                  background: 'var(--b3)',
                  height: '1px',
                  width: '20px',
                }}
              />
            </span>
          </button>
        </Show>
      </div>
      <div
        style={{
          'align-items': 'center',
          color: 'var(--c4)',
          display: 'flex',
          'flex-wrap': 'wrap',
          gap: mobile() ? '16px' : '24px',
          'justify-content': 'center',
        }}
      >
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            'font-size': '13px',
            gap: '8px',
          }}
        >
          <CheckMark /> Full support
        </span>
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            'font-size': '13px',
            gap: '8px',
          }}
        >
          <PartialMark /> Partial / limited
        </span>
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            'font-size': '13px',
            gap: '8px',
          }}
        >
          <CrossMark /> Not available
        </span>
        <Show when={mobile()}>
          <span
            style={{
              'font-family': 'rajdhani, body',
              'font-size': '11px',
              'letter-spacing': '0.06em',
              opacity: 0.6,
              'text-transform': 'uppercase',
              width: '100%',
              'text-align': 'center',
            }}
          >
            Scroll table sideways →
          </span>
        </Show>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

function CallsFinalCta() {
  return (
    <section
      aria-label="Get started"
      style={{
        'align-items': mobile() ? 'start' : 'center',
        display: 'grid',
        gap: mobile() ? '24px' : '28px',
        'justify-items': mobile() ? 'start' : 'center',
        'text-align': mobile() ? 'left' : 'center',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '14px' : '16px',
          'justify-items': mobile() ? 'start' : 'center',
          'max-width': '585px',
        }}
      >
        <h2
          style={{
            'font-family': 'display',
            'font-size': mobile() ? '38px' : '48px',
            'font-weight': '420',
            'letter-spacing': '-0.015em',
            'line-height': 1.08,
            margin: '0',
          }}
        >
          Calls become memory.
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-family': 'body',
            'font-size': mobile() ? '17px' : '19px',
            'font-weight': '400',
            'line-height': 1.55,
            margin: '0',
          }}
        >
          It takes 30 seconds to connect your workspace and bring calls, email,
          tasks, docs, and agents into one shared memory.
        </p>
      </div>
      <ConnectGoogleButton buttonName="calls_final_connect_google" large />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteCalls: Component = () => {
  setPageSeo({
    title: 'Macro Calls — Video Calls with Perfect Memory',
    description:
      'Host and join video calls inside Macro. Every call is recorded, transcribed, and summarized into shared team memory your whole team and your agents can search.',
    path: '/calls',
  });

  const [heroDemoOpen, setHeroDemoOpen] = createSignal(false);

  return (
    <div
      lang="en"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-template-columns': 'minmax(0, 1fr)',
        gap: '0',
        'padding-bottom': mobile() ? '48px' : '64px',
        width: '100%',
      }}
    >
      <style>{`
        @media (hover) {
          .calls-cta-button:hover { transform: scale(1.02); }
        }
        ${loopsFeatureHoverStyles()}
      `}</style>

      {/* Hero — interactive app preview on the gradient backdrop. */}
      <div
        style={{
          display: 'flow-root',
          position: 'relative',
          width: '100%',
          'min-width': '0',
        }}
      >
        <HomeHeroBackdrop subtle neutral />

        <section
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            'justify-items': mobile() ? 'start' : 'center',
            'padding-bottom': '0',
            'padding-inline': mobile() ? '18px' : '24px',
            'padding-top': mobile() ? '96px' : '128px',
            position: 'relative',
            'z-index': 1,
            width: '100%',
          }}
        >
          <div
            style={{
              'box-sizing': 'border-box',
              display: 'grid',
              gap: mobile() ? '24px' : '28px',
              'justify-items': mobile() ? 'start' : 'center',
              'max-width': mobile() ? '100%' : '720px',
              'text-align': mobile() ? 'left' : 'center',
              width: '100%',
            }}
          >
            <h1
              style={{
                'font-family': 'display',
                'font-size': mobile() ? 'clamp(44px, 12vw, 60px)' : '52.36px',
                'font-weight': '380',
                'letter-spacing': '-0.012em',
                'line-height': 1.12,
                margin: '0',
                'white-space': mobile() ? 'normal' : 'nowrap',
              }}
            >
              Calls with perfect memory.
            </h1>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'body',
                'font-size': mobile() ? '16.5px' : '23px',
                'font-weight': '400',
                'line-height': 1.5,
                margin: '0',
                'max-width': mobile() ? '34ch' : '600px',
              }}
            >
              Host and join video calls in Macro. Every one is recorded,
              transcribed, and summarized into shared memory your team and your
              agents can search.
            </p>
            <div
              style={{
                'align-items': 'center',
                display: 'flex',
                'flex-direction': mobile() ? 'column' : 'row',
                gap: mobile() ? '12px' : '14px',
                'justify-content': mobile() ? 'flex-start' : 'center',
                'margin-top': mobile() ? '4px' : '8px',
                width: mobile() ? '100%' : 'auto',
              }}
            >
              <ConnectGoogleButton buttonName="calls_hero_connect_google" />
              <WatchDemoButton onClick={() => setHeroDemoOpen(true)} />
            </div>
          </div>
        </section>

        <HomeAppPreview
          mobile={mobile}
          defaultSection="calls"
          showStrip={false}
          fadeBottom
          keepSidebarCollapsed
        />
      </div>

      <HomeSectionRule />

      {/* The fundamentals — single row of differentiators */}
      <CallsFeatureGrid />

      <HomeSectionRule />

      {/* Every call, summarized — split text + spotlight */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={summaryBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      <HomeSectionRule />

      {/* On the call — full bright in-call window */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={stageBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      <HomeSectionRule />

      {/* Your agents were there — spotlight phone over dimmed summary */}
      <div
        style={{
          'padding-block': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={agentBlock}
          textLayout="split"
          spotlight
          spotlightGlow={0}
        />
      </div>

      {/* 2x2 of concrete call UI elements */}
      <CallsUiGrid />

      {/* Comparison */}
      <ComparisonSection />

      <HomeSectionRule />

      {/* Final CTA */}
      <div
        style={{
          'padding-block': mobile() ? '52px' : '68px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <CallsFinalCta />
      </div>

      {/* Divider + footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/calls" footerOnly />
      </div>

      <Show when={heroDemoOpen()}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Macro demo video"
          onClick={() => setHeroDemoOpen(false)}
          style={{
            'align-items': 'center',
            background: 'oklch(from var(--b0) l c h / 0.86)',
            display: 'grid',
            inset: '0',
            'justify-items': 'center',
            padding: mobile() ? '18px' : '42px',
            position: 'fixed',
            'z-index': 100,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: 'var(--b0)',
              border:
                '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
              'border-radius': '12px',
              'box-shadow': '0 28px 90px rgb(0 0 0 / 0.5)',
              'box-sizing': 'border-box',
              display: 'grid',
              'max-width': '1040px',
              overflow: 'hidden',
              position: 'relative',
              width: 'min(100%, 1040px)',
            }}
          >
            <button
              type="button"
              aria-label="Close video"
              onClick={() => setHeroDemoOpen(false)}
              style={{
                background: 'var(--b1)',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
                'border-radius': '999px',
                color: 'var(--c1)',
                cursor: 'pointer',
                'font-family': 'body',
                'font-size': '18px',
                height: '34px',
                'line-height': 1,
                position: 'absolute',
                right: '12px',
                top: '12px',
                width: '34px',
                'z-index': 1,
              }}
            >
              X
            </button>
            <iframe
              title="Macro demo video"
              src={`https://www.youtube.com/embed/${HERO_DEMO_VIDEO_ID}?autoplay=1&rel=0`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              style={{
                'aspect-ratio': '16 / 9',
                background: 'var(--b1)',
                border: '0',
                display: 'block',
                height: 'auto',
                'max-height': 'calc(100vh - 96px)',
                width: '100%',
              }}
            />
          </div>
        </div>
      </Show>
    </div>
  );
};
