import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  CtaIcon,
  ctaHref,
  ctaLabel,
  handleCtaClick,
} from '../../utils/utilCta';
import { HeroEyebrow } from './HeroEyebrow';
import '../../routes/RouteTasks.css';
import TaskCreationFlow from '../../../assets/graphics/task-creation-flow.svg';
import { HomeHeroBackdrop } from './HomeAppPreview';

// ---------------------------------------------------------------------------
// The /tasks page hero: headline + CTAs above the task-creation-flow graphic
// with its Convert / Delegate / Done step rail. ConnectGoogleButton is shared
// with the route's final CTA. Both buttons rely on the .tasks-cta-button hover
// rule injected by the route's style block.
// ---------------------------------------------------------------------------

const mobile = () => viewportWidth() < 700;

// ---------------------------------------------------------------------------
// CTAs
// ---------------------------------------------------------------------------

export function ConnectGoogleButton(props: {
  buttonName: string;
  large?: boolean;
}) {
  return (
    <a
      href={ctaHref()}
      class="tasks-cta-button"
      onClick={(event) => handleCtaClick(event, props.buttonName)}
      style={{
        'align-items': 'center',
        'background-color': 'var(--c1)',
        border: '1px solid transparent',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--b0)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': props.large ? (mobile() ? '16px' : '17px') : '14px',
        'font-weight': '700',
        gap: props.large ? '8px' : '7px',
        height: props.large ? (mobile() ? '46px' : '48px') : '30px',
        'justify-content': 'center',
        'letter-spacing': '0.01em',
        'line-height': 1,
        overflow: 'hidden',
        padding: props.large ? '0 28px' : '0 18px',
        'text-decoration': 'none',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
      }}
    >
      <CtaIcon size={props.large ? 16 : 15} opacity={0.9} />
      {ctaLabel('Connect with Google')}
    </a>
  );
}

function WatchDemoButton(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Watch demo video"
      class="tasks-cta-button"
      onClick={props.onClick}
      style={{
        'align-items': 'center',
        'background-color': 'color-mix(in srgb, var(--b2) 80%, var(--b0))',
        border: '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'pointer',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': '14px',
        'font-weight': '700',
        gap: '7px',
        height: '30px',
        'justify-content': 'center',
        'letter-spacing': '0.02em',
        'line-height': 1,
        padding: '0 14px',
        transition: 'border-color 220ms ease, transform 160ms ease',
        'white-space': 'nowrap',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          'border-bottom': '4px solid transparent',
          'border-left': '7px solid var(--a0)',
          'border-top': '4px solid transparent',
          display: 'block',
          height: '0',
          width: '0',
        }}
      />
      Watch demo
    </button>
  );
}

// Numeral markers for the Convert / Delegate / Done steps, in place of the
// icons the list used to carry.
function StepNumber(props: { value: number }) {
  return (
    <span
      aria-hidden="true"
      style={{
        'font-family': 'rajdhani, body',
        'font-size': '19px',
        'font-variant-numeric': 'tabular-nums',
        'font-weight': '700',
        'line-height': 1,
        opacity: 0.88,
      }}
    >
      {props.value}.
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

export function TasksHero(props: { onWatchDemo: () => void }) {
  return (
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
          'justify-items': 'center',
          'padding-bottom': '0',
          'padding-inline': mobile() ? '18px' : '14px',
          'padding-top': '132px',
          position: 'relative',
          'z-index': 1,
          width: '100%',
        }}
      >
        <div
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            gap: mobile() ? '20px' : '26px',
            'grid-template-columns': 'minmax(0, 1fr)',
            'justify-items': 'start',
            'max-width': '1160px',
            'text-align': 'left',
            width: '100%',
          }}
        >
          <HeroEyebrow label="Macro Tasks" mobile={mobile} />
          <h1 class="tasks-h1">
            Tasks that keep up <br /> with your team.
          </h1>
          <p
            class="tasks-lead"
            style={{
              'max-width': mobile() ? '100%' : '46ch',
              'text-wrap': 'balance',
            }}
          >
            Macro Tasks self-update based on conversations in your channels, so
            you don't need a separate task manager.
          </p>
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              'flex-wrap': 'wrap',
              gap: '14px',
              'margin-top': mobile() ? '2px' : '6px',
            }}
          >
            <ConnectGoogleButton buttonName="tasks_hero_connect_google" />
            <WatchDemoButton onClick={props.onWatchDemo} />
          </div>
        </div>
      </section>

      <div
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          'justify-items': 'center',
          // Clips the connector glow to the rule that closes the hero, so it
          // cannot bleed into the next section. This row's bottom edge IS that
          // rule's position, so letting layout do the cut is exact at every
          // width — an earlier attempt used a calc() mask on the glow itself
          // and drifted, because the distance from the artwork's bottom to the
          // rule is not constant: this row's height is set by whichever column
          // is taller, and that is the copy column at some widths and the
          // graphic at others (56px of gap at 1040, 61.6px at 1440).
          //
          // Vertical only. Plain 'clip' would also cut the glow's horizontal
          // falloff at ~0.69 of its radius, where alpha is still ~5% — a
          // visible vertical edge. 'visible' survives alongside 'clip' (it is
          // only coerced to 'auto' by scroll/auto/hidden), so the horizontal
          // extent is untouched and no scroll container is created.
          'overflow-x': 'visible',
          'overflow-y': 'clip',
          'padding-block': mobile() ? '28px 24px' : '40px 56px',
          'padding-inline': mobile() ? '18px' : '24px',
          position: 'relative',
          width: '100%',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            // Centred behind the artwork, not behind the whole hero row. This
            // layer spans the copy column too, so the centre is expressed as a
            // fraction of the layer, not of the graphic: measured against THIS
            // box (1276x733, offset from the section because the layer starts
            // at the graphic band), the painted panels centre at 67.8% x /
            // 49.6% y. Note the hero also carries an outer wash layer with its
            // own radial at 50% 86% — a different, larger box — so measure
            // against the right one when retuning this.
            //
            // Stacked, the graphic centres at exactly 50%, so the position has
            // to be per-breakpoint; a single 68% would sit off to the right of
            // a centred graphic on mobile.
            background: mobile()
              ? 'radial-gradient(56% 64% at 50% 44%, color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 4%, transparent) 42%, transparent 70%)'
              : 'radial-gradient(56% 64% at 68% 50%, color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 4%, transparent) 42%, transparent 70%)',
            inset: mobile() ? '8% 0' : '-2% 0',
            'pointer-events': 'none',
            position: 'absolute',
            'z-index': 0,
          }}
        />
        <div
          style={{
            'align-items': 'center',
            display: 'grid',
            gap: mobile() ? '28px' : 'clamp(36px, 5vw, 64px)',
            'grid-template-columns': mobile()
              ? 'minmax(0, 1fr)'
              : 'minmax(220px, 0.8fr) minmax(0, 1.55fr)',
            'max-width': '1160px',
            position: 'relative',
            width: '100%',
            'z-index': 1,
          }}
        >
          <div
            style={{
              left: mobile() ? 'auto' : '0',
              'max-width': mobile() ? 'none' : '320px',
              position: 'relative',
              width: '100%',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                background:
                  'linear-gradient(to bottom, transparent, color-mix(in srgb, var(--a0) 38%, transparent) 12%, color-mix(in srgb, var(--a0) 38%, transparent) 88%, transparent)',
                bottom: '4px',
                left: '-16px',
                position: 'absolute',
                top: '4px',
                width: '1px',
              }}
            />
            <ol
              style={{
                display: 'flex',
                'flex-direction': 'column',
                gap: mobile() ? '18px' : '42px',
                'justify-content': 'flex-start',
                'list-style': 'none',
                margin: '0',
                padding: '0',
              }}
            >
              <li>
                <strong
                  style={{
                    color: 'var(--a0)',
                    'align-items': 'center',
                    display: 'flex',
                    'font-family': 'body',
                    'font-size': mobile() ? '18px' : '20px',
                    'font-weight': '700',
                    gap: '6px',
                    'letter-spacing': '0.035em',
                    'line-height': 1.2,
                  }}
                >
                  <StepNumber value={1} />
                  Message
                </strong>
                <span
                  style={{
                    color: 'var(--c4)',
                    display: 'block',
                    'font-size': '15px',
                    'line-height': 1.5,
                    'margin-top': '5px',
                    'text-wrap': 'balance',
                  }}
                >
                  Describe the issue in plain language, in chat or a design
                  document.
                </span>
              </li>
              <li>
                <strong
                  style={{
                    color: 'var(--a0)',
                    'align-items': 'center',
                    display: 'flex',
                    'font-family': 'body',
                    'font-size': mobile() ? '18px' : '20px',
                    'font-weight': '700',
                    gap: '6px',
                    'letter-spacing': '0.035em',
                    'line-height': 1.2,
                  }}
                >
                  <StepNumber value={2} />
                  Convert
                </strong>
                <span
                  style={{
                    color: 'var(--c4)',
                    display: 'block',
                    'font-size': '15px',
                    'line-height': 1.5,
                    'margin-top': '5px',
                    'text-wrap': 'balance',
                  }}
                >
                  One click converts descriptive text into a task. Or use the
                  send as task toggle.
                </span>
              </li>
              <li>
                <strong
                  style={{
                    color: 'var(--a0)',
                    'align-items': 'center',
                    display: 'flex',
                    'font-family': 'body',
                    'font-size': mobile() ? '18px' : '20px',
                    'font-weight': '700',
                    gap: '6px',
                    'letter-spacing': '0.035em',
                    'line-height': 1.2,
                  }}
                >
                  <StepNumber value={3} />
                  Hand off
                </strong>
                <span
                  style={{
                    color: 'var(--c4)',
                    display: 'block',
                    'font-size': '15px',
                    'line-height': 1.5,
                    'margin-top': '5px',
                    'text-wrap': 'balance',
                  }}
                >
                  Assign it to a teammate or an agent. Updates land in your
                  inbox.
                </span>
              </li>
            </ol>
          </div>
          {/* Keep the ambient layer outside the filtered artwork so its soft
              edges are not clipped by the filter buffer. */}
          <div
            style={{
              'grid-column': mobile() ? 'auto' : '2',
              'max-width': '650px',
              position: 'relative',
              transform: 'none',
              width: '100%',
            }}
          >
            {/* A faint neutral lift beneath the panel; the black canvas stays
                dominant while the card retains a little depth. */}
            <div
              aria-hidden="true"
              style={{
                background:
                  'radial-gradient(50% 50% at 50% 50%, color-mix(in srgb, var(--ambient-ink) 3.5%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 3%, transparent) 30%, color-mix(in srgb, var(--ambient-ink) 2%, transparent) 55%, color-mix(in srgb, var(--ambient-ink) 0.8%, transparent) 78%, transparent 100%)',
                height: '124%',
                left: '-30%',
                // No mask here: the hero row clips this vertically at the rule
                // that closes the section — see the overflow note there.
                'pointer-events': 'none',
                position: 'absolute',
                top: '40%',
                width: '160%',
                'z-index': 0,
              }}
            />
            <div
              style={{
                // Heavier than the email hero's pair, same light direction so it
                // still reads as one lighting setup: a wide soft cast for weight
                // plus a tighter, darker one for edge definition. These resolve
                // in CSS px (a filter on an HTML element, not an SVG child), and
                // they sit on this wrapper rather than on the artwork so the
                // tilt cannot clip them. Nothing that needs to paint outside
                // the artwork's box may live inside this element.
                filter: mobile()
                  ? 'none'
                  : 'drop-shadow(22px 10px 42px rgb(0 0 0 / 0.55)) drop-shadow(12px 4px 14px rgb(0 0 0 / 0.32))',
                position: 'relative',
                width: '100%',
                'z-index': 1,
              }}
            >
              <div
                style={{
                  perspective: mobile() ? 'none' : '2400px',
                  width: '100%',
                }}
              >
                {/* Inlined rather than loaded through <img>: this export keeps its
                    labels as live <text>, and an <img> SVG is an isolated document
                    that cannot see the page's Inter @font-face — the type would
                    render in a fallback face. */}
                <TaskCreationFlow
                  role="img"
                  aria-label="Macro task creation flow showing a message becoming a task"
                  style={{
                    display: 'block',
                    height: 'auto',
                    transform: mobile()
                      ? 'none'
                      : 'rotateX(10deg) rotateY(-8deg)',
                    'transform-origin': 'center center',
                    'user-select': 'none',
                    width: '100%',
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
