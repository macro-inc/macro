import { createSignal, For, type JSX, Show } from 'solid-js';
import EmptyStateAutomations from '../../../assets/graphics/empty-state-automations.svg';
import { breakpoint, viewportWidth } from '../../utils/utilBreakpoint';
import { AiComposeGraphic } from '../graphics/AiComposeGraphic';

const mobile = () => viewportWidth() < 700;

function FigLabel(props: { children: JSX.Element }) {
  return (
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
      {props.children}
    </span>
  );
}

// The automations empty-state graphic + feature bullets (AI section, left side).
// Styled like the feature-grid figs below the "Email less" section: a Fig
// label, a line-art graphic (lighter fills, matching the fig graphics), a
// subtle divider, then a title + short blurb.
function AiAutomations() {
  return (
    <div
      style={{
        'background-color': 'color-mix(in srgb, var(--b1) 60%, var(--b0))',
        border: '1px solid color-mix(in srgb, var(--b4) 22%, transparent)',
        'border-radius': '16px',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '16px' : '18px',
        'justify-items': 'start',
        'max-width': '244px',
        padding: mobile() ? '18px' : '22px',
        width: '100%',
      }}
    >
      <FigLabel>Fig 0.4</FigLabel>
      <div style={{ 'aspect-ratio': '24.45 / 16.34', width: '100%' }}>
        <EmptyStateAutomations
          style={{
            color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))',
            '--color-surface': 'var(--b1)',
            display: 'block',
            height: '100%',
            width: '100%',
          }}
        />
      </div>
      {/* subtle divider — same hairline the fig tiles use */}
      <span
        aria-hidden="true"
        style={{
          'background-color': 'color-mix(in srgb, var(--b4) 20%, transparent)',
          height: '1px',
          width: '100%',
        }}
      />
      <div style={{ display: 'grid', gap: '7px', width: '100%' }}>
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
          Agent automations
        </span>
        <span
          style={{
            color: 'var(--c4)',
            'font-family': 'body',
            'font-size': mobile() ? '12.5px' : '13px',
            'font-weight': '500',
            'line-height': 1.5,
          }}
        >
          Agents send daily inbox summaries, fire custom notifications, and
          clear your inbox on a schedule.
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AI figure connector config — EASY TO TWEAK. The figure box is full-width and
// AI_FIG_H tall; the phone is centred in it. Callout coordinates are relative
// to the PHONE'S CENTRE:  x = px to the RIGHT of centre,  y = px from the top.
//   anchor: [x, y] → the point ON THE PHONE the leader starts at (+ a dot)
//   label:  [x, y] → where the label text sits / the flattened leader ends
// The leader runs a 45° segment from the anchor until it reaches the label's y,
// then goes horizontal ("flat") to the label. Nudge these numbers freely.
// ---------------------------------------------------------------------------
const AI_FIG_H = 670; // figure box height (px) — extra 70px vs the phone gives padding above and below
const AI_SVG_W = 340; // leader overlay width, from screen centre rightward (px)
const AI_CALLOUTS: {
  anchor: [number, number];
  label: [number, number];
  text: JSX.Element;
}[] = [
  {
    anchor: [-130, 278],
    label: [-250, 278],
    text: <>1. Scans your prior threads</>,
  },
  {
    anchor: [-130, 420],
    label: [-283, 350],
    text: <>2. Drafts in your voice</>,
  },
  {
    anchor: [-130, 505],
    label: [-225, 422],
    text: <>3. Sends only when you say so</>,
  },
];
// When the phone's "Show more" is clicked, the leaders fade out and the labels
// slide into a uniform stack at the bottom-right of the phone (centre-relative px).
const AI_STACK_X = -152; // x of the stacked labels (negative = left of centre)
const AI_STACK_Y_TOP = 462; // y of the top stacked label
const AI_STACK_GAP = 40; // vertical gap between stacked labels

// A 45°-then-flat leader line: from the anchor, run 45° until the label's y,
// then horizontal to the label. (45° ⇒ horizontal run equals vertical run.)
function aiConnectorPoints(
  anchor: [number, number],
  label: [number, number]
): string {
  const [ax, ay] = anchor;
  const [lx, ly] = label;
  // Bend toward the label — right if it's to the right of the anchor, left if
  // to the left — so labels can live on either side of the phone.
  const dir = lx >= ax ? 1 : -1;
  const bendX = ax + dir * Math.abs(ly - ay);
  return `${ax},${ay} ${bendX},${ly} ${lx},${ly}`;
}

function AiCalloutText(props: { children: JSX.Element }) {
  return (
    <span
      style={{
        color: 'var(--a0)',
        'font-family': 'body',
        'font-size': mobile() ? '15px' : '16px',
        'line-height': 1.4,
      }}
    >
      {props.children}
    </span>
  );
}

// Phone + automations card + callouts. Shared by /email and the homepage
// agents/CRM feature so both surfaces stay one composition.
export function AiComposeFigure() {
  const stacked = () => breakpoint();
  // Set once the phone's "Show more" is clicked (one-way).
  const [aiExpanded, setAiExpanded] = createSignal(false);
  return (
    <>
      <style>{`
        @media (max-width: 699px) {
          .ai-compose-callouts-stacked {
            display: none !important;
          }
        }
      `}</style>
      <Show
        when={!stacked()}
        fallback={
          /* Stacked (medium/narrow): the phone leads. The callout list and automations
              companion card are hidden on mobile. */
          <div
            style={{ display: 'grid', gap: '36px', 'justify-items': 'center' }}
          >
            <AiComposeGraphic />
            <Show when={!mobile()}>
              <ul
                class="ai-compose-callouts-stacked"
                style={{
                  display: 'grid',
                  gap: '14px',
                  'list-style': 'none',
                  margin: 0,
                  padding: 0,
                }}
              >
                <For each={AI_CALLOUTS}>
                  {(c) => (
                    <li>
                      <AiCalloutText>{c.text}</AiCalloutText>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </div>
        }
      >
        {/* Desktop figure — a full-width box (so its left edge lines up with
          the title). The phone is centred on the page; automations sits at
          the left edge; callouts/dots/SVG are positioned relative to the
          phone's centre. */}
        <div
          style={{
            height: `${AI_FIG_H}px`,
            position: 'relative',
            width: '100%',
          }}
        >
          {/* Subtle orange glow rising from behind the phone's base. Its own
            overflow-hidden div clips it at the figure's bottom so it can't
            bleed into the everything-inbox section below. */}
          <div
            aria-hidden="true"
            style={{
              bottom: '0',
              height: '92%',
              left: '50%',
              'max-width': '100%',
              overflow: 'hidden',
              'pointer-events': 'none',
              position: 'absolute',
              transform: 'translateX(-50%)',
              width: '1040px',
              'z-index': 0,
            }}
          >
            <div
              style={{
                background:
                  'radial-gradient(64% 62% at 50% 100%, color-mix(in srgb, var(--ambient-ink) 12%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 5%, transparent) 42%, transparent 80%)',
                inset: '0',
                position: 'absolute',
              }}
            />
          </div>

          {/* Automations fig — top-right corner */}
          <div
            style={{
              'max-width': '260px',
              position: 'absolute',
              right: '0',
              bottom: '116px',
              'z-index': 1,
            }}
          >
            <AiAutomations />
          </div>

          {/* Phone — held with 23px padding from the top so a little
            breathing room opens up above and below it. */}
          <div
            style={{
              left: '50%',
              position: 'absolute',
              top: '50%',
              transform: 'translate(-50%, calc(-50% - 25px))',
              width: '280px',
              'z-index': 1,
            }}
          >
            <AiComposeGraphic onExpand={() => setAiExpanded(true)} />
          </div>

          {/* Connector leaders (45° then flat) — overlay from centre rightward.
            x=0 in the SVG sits at the phone's centre. */}
          <svg
            viewBox={`0 0 ${AI_SVG_W} ${AI_FIG_H}`}
            aria-hidden="true"
            style={{
              height: `${AI_FIG_H}px`,
              left: '50%',
              opacity: aiExpanded() ? '0' : '1',
              overflow: 'visible',
              'pointer-events': 'none',
              position: 'absolute',
              top: '0',
              transition: 'opacity 320ms ease',
              width: `${AI_SVG_W}px`,
              'z-index': 2,
            }}
          >
            <For each={AI_CALLOUTS}>
              {(c) => (
                <polyline
                  points={aiConnectorPoints(c.anchor, c.label)}
                  opacity="0.45"
                  fill="none"
                  stroke="var(--a0)"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  vector-effect="non-scaling-stroke"
                />
              )}
            </For>
          </svg>

          {/* Dots on the phone parts (relative to centre) */}
          <For each={AI_CALLOUTS}>
            {(c) => (
              <span
                aria-hidden="true"
                style={{
                  'background-color': 'var(--a0)',
                  'border-radius': '999px',
                  height: '7px',
                  left: `calc(50% + ${c.anchor[0]}px)`,
                  opacity: aiExpanded() ? '0' : '1',
                  position: 'absolute',
                  top: `${c.anchor[1]}px`,
                  transform: 'translate(-50%, -50%)',
                  transition: 'opacity 320ms ease',
                  width: '7px',
                  'z-index': 3,
                }}
              />
            )}
          </For>

          {/* Callout labels — at each leader's flat end (anchored on whichever
            side of centre the label sits), or stacked uniformly once the
            phone is expanded. A negative x puts the label left of centre;
            it then right-aligns and extends leftward. */}
          <For each={AI_CALLOUTS}>
            {(c, i) => {
              const x = () => (aiExpanded() ? AI_STACK_X : c.label[0]);
              const y = () =>
                aiExpanded() ? AI_STACK_Y_TOP + i() * AI_STACK_GAP : c.label[1];
              const onLeft = () => x() < 0;
              return (
                <div
                  style={{
                    left: onLeft() ? 'auto' : `calc(50% + ${x()}px)`,
                    right: onLeft() ? `calc(50% - ${x()}px)` : 'auto',
                    'max-width': '240px',
                    'padding-left': onLeft() ? '0' : '10px',
                    'padding-right': onLeft() ? '10px' : '0',
                    position: 'absolute',
                    'text-align': onLeft() ? 'right' : 'left',
                    top: `${y()}px`,
                    transform: 'translateY(-50%)',
                    transition:
                      'top 420ms cubic-bezier(0.22, 1, 0.36, 1), left 420ms cubic-bezier(0.22, 1, 0.36, 1), right 420ms cubic-bezier(0.22, 1, 0.36, 1)',
                    'z-index': 3,
                  }}
                >
                  <AiCalloutText>{c.text}</AiCalloutText>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </>
  );
}
