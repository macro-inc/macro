import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import accountsBgUrl from '../../assets/graphics/accounts-inbox-bg.svg?url';
import accountsPanelUrl from '../../assets/graphics/accounts-panel.svg?url';
import EmptyStateAutomations from '../../assets/graphics/empty-state-automations.svg';
import heroSignalNoiseUrl from '../../assets/graphics/hero-signal-noise.svg?url';
import mobileHeroSignalNoiseUrl from '../../assets/graphics/sigvnoise_mobile.svg?url';
import LogoGmail from '../../assets/icons/logo-gmail.svg';
import LogoOutlook from '../../assets/icons/logo-outlook.svg';
import LogoSuperhuman from '../../assets/icons/logo-superhuman.svg';
import avatarJacobPersonal from '../../assets/people/jacob-personal.webp';
import avatarJacobVc from '../../assets/people/jacob-vc.webp';
import avatarJacobWork from '../../assets/people/jacob-work.webp';
import {
  EmailAiSpotlight,
  EmailComposeSpotlight,
  UnifiedInboxPlayer,
} from '../components/featureGraphics/EmailGraphics';
import { AiComposeGraphic } from '../components/graphics/AiComposeGraphic';
import {
  type ComparisonColumn,
  ComparisonLegend,
  type ComparisonRow,
  ComparisonTable,
} from '../components/sections/ComparisonTable';
import { EmailFeatureGrid } from '../components/sections/EmailFeatureGrid';
import { EmailFilteringSection } from '../components/sections/EmailFilteringSection';
import { HeroEyebrow } from '../components/sections/HeroEyebrow';
import { HomeHeroBackdrop } from '../components/sections/HomeAppPreview';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import {
  type LoopsFeatureBlock,
  LoopsFeatureSection,
  loopsFeatureHoverStyles,
} from '../components/sections/LoopsFeatureSection';
import {
  dataSecurityFaqItem,
  type FaqItem,
  SectionFaq,
} from '../components/sections/SectionFaq';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { breakpoint, viewportWidth } from '../utils/utilBreakpoint';
import { CtaIcon, ctaHref, ctaLabel, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';

const HERO_DEMO_VIDEO_ID = 'tnsxkywzTvY';

const mobile = () => viewportWidth() < 700;

// The desktop hero uses the complete signal/noise composition. Mobile has its
// own portrait composition, authored to remain legible without a crop.
function MobileHeroInbox() {
  return (
    <div
      style={{
        'max-width': '420px',
        width: '100%',
      }}
    >
      <img
        src={mobileHeroSignalNoiseUrl}
        alt="Macro Mail sorting a busy inbox into signal and noise"
        draggable={false}
        style={{
          display: 'block',
          height: 'auto',
          'user-select': 'none',
          width: '100%',
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CTAs
// ---------------------------------------------------------------------------

// Both CTAs follow the home page's pill language: the primary is the same
// `--c1` pill as the header/final "Get started" buttons, and the secondary
// matches the quiet bordered pill of the hero's GitHub-stars button.
function ConnectGoogleButton(props: { buttonName: string; large?: boolean }) {
  return (
    <a
      href={ctaHref()}
      class="email-cta-button"
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
      class="email-cta-button"
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

// Inline orange "+" bullet — matches the EmailFilteringSection checklist, for
// use inside split-section body copy (a real <ul> can't nest in the <p>).
function PlusMark() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{
        display: 'inline-block',
        'margin-right': '7px',
        'vertical-align': 'middle',
      }}
    >
      <path
        d="M12 5 V19 M5 12 H19"
        fill="none"
        stroke="var(--a0)"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

// Brightens a key word to the full text color inside otherwise-muted body copy.
function Hi(props: { children: JSX.Element }) {
  return <span style={{ color: 'var(--c1)' }}>{props.children}</span>;
}

// Small uppercase rajdhani fiducial label (e.g. "Fig 1.1") matching the
// feature-grid figure captions — used as an eyebrow above section titles.
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

// ---------------------------------------------------------------------------
// Split spotlight sections (one full-bleed graphic each)
// ---------------------------------------------------------------------------

// Section order argues email-first (per the positioning doc): every account in
// one fast inbox -> compose speed -> AI drafting. The unified workspace inbox
// is real but secondary here — it closes the sequence as a "beyond email"
// bonus instead of leading it.
const accountsBlock: LoopsFeatureBlock = {
  label: 'Macro Mail',
  fig: 'Feature 1.1',
  headline: (
    <>
      All your accounts
      <br />
      in one inbox.
    </>
  ),
  description: (
    <>
      Triage every account as{' '}
      <span style={{ color: 'var(--c1)' }}>one list</span>.<br />
      Mail and attachments backfill into Macro’s <br /> database, giving you
      <span style={{ color: 'var(--c1)' }}>split-second search</span> and{' '}
      <span style={{ color: 'var(--c1)' }}>AI</span>.
    </>
  ),
  heroShot: () =>
    // Mobile promotes the account-picker itself, matching the scale and
    // centered treatment of the compose UI below. The richer inbox backdrop is
    // retained on wider screens where it has room to breathe.
    mobile() ? (
      <div
        style={{ display: 'grid', 'justify-items': 'center', width: '100%' }}
      >
        <div style={{ position: 'relative', width: 'min(100%, 360px)' }}>
          <img
            src={accountsPanelUrl}
            alt="Three email accounts combined in one inbox"
            draggable={false}
            style={{
              display: 'block',
              height: 'auto',
              'user-select': 'none',
              width: '100%',
            }}
          />
          <For
            each={[
              { src: avatarJacobWork, cy: 84 },
              { src: avatarJacobPersonal, cy: 124 },
              { src: avatarJacobVc, cy: 164 },
            ]}
          >
            {(a) => (
              <img
                src={a.src}
                alt=""
                draggable={false}
                style={{
                  'aspect-ratio': '1',
                  'border-radius': '999px',
                  left: '13.67%',
                  'object-fit': 'cover',
                  position: 'absolute',
                  top: `${((a.cy - 32.25) / 162) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  'user-select': 'none',
                  width: '7.5%',
                }}
              />
            )}
          </For>
        </div>
      </div>
    ) : (
      // Re-composed from two SVGs sharing the 880×348 artboard: the dimmed inbox
      // background (accounts-inbox-bg, 0.45 opacity baked in) carries the radial
      // feather, and the crisp multi-inbox panel (accounts-panel) sits over the
      // card region at full opacity so it reads sharp against the faded inbox.
      // Same 1.2 scale + position as the previous graphic, so it lines up; the
      // panel is placed at x=191.25 y=32.25 (of 880×348) — exactly where the card
      // was — and the avatars land on its placeholder circles.
      <div style={{ width: '138%' }}>
        <div
          style={{
            position: 'relative',
            width: '100%',
            transform: 'scale(1.2) translate(-6%, 20%)',
          }}
        >
          {/* Dimmed inbox behind; the radial feather fades it out at the edges. */}
          <img
            src={accountsBgUrl}
            alt="Multiple email accounts unified into one Macro inbox"
            draggable={false}
            style={{
              opacity: 0.45,
              display: 'block',
              height: 'auto',
              'user-select': 'none',
              width: '100%',
              '-webkit-mask-image':
                'radial-gradient(48% 40% at 50% 34%, #000 60%, transparent 100%)',
              'mask-image':
                'radial-gradient(48% 40% at 50% 34%, #000 60%, transparent 100%)',
            }}
          />
          {/* Crisp multi-inbox panel over the card region, full opacity. The
            drop-shadow follows the card's rounded silhouette (its alpha), lifting
            it off the dimmed inbox behind. */}
          <img
            src={accountsPanelUrl}
            alt=""
            draggable={false}
            style={{
              display: 'block',
              filter: 'drop-shadow(0 10px 26px rgb(0 0 0 / 0.45))',
              height: 'auto',
              left: `${(191.25 / 880) * 100}%`,
              position: 'absolute',
              top: `${(32.25 / 348) * 100}%`,
              'user-select': 'none',
              width: `${(320 / 880) * 100}%`,
            }}
          />
          {/* Profile photos on the panel's placeholder circles (r=12 at x=235,
            y=84/124/164 of the 880×348 artboard). */}
          <For
            each={[
              { src: avatarJacobWork, cy: 84 },
              { src: avatarJacobPersonal, cy: 124 },
              { src: avatarJacobVc, cy: 164 },
            ]}
          >
            {(a) => (
              <img
                src={a.src}
                alt=""
                draggable={false}
                style={{
                  'aspect-ratio': '1',
                  'border-radius': '999px',
                  left: `${(235 / 880) * 100}%`,
                  'object-fit': 'cover',
                  position: 'absolute',
                  top: `${(a.cy / 348) * 100}%`,
                  transform: 'translate(-50%, -50%)',
                  'user-select': 'none',
                  width: `${(24 / 880) * 100}%`,
                }}
              />
            )}
          </For>
        </div>
      </div>
    ),
  heroBare: true,
};

const composeBlock: LoopsFeatureBlock = {
  label: 'Macro Mail',
  fig: 'Feature 1.2',
  headline: (
    <>
      Compose without
      <br />
      context switching.
    </>
  ),
  description: (
    <>
      Type <Hi>@</Hi> and keep moving.
    </>
  ),
  // The @-mention payoff as its own cell below the copy — a proper list rather
  // than lines crammed into the description paragraph.
  footer: (
    <ul
      style={{
        color: 'var(--c4)',
        display: 'grid',
        'font-family': 'body',
        'font-size': mobile() ? '17px' : '19px',
        gap: mobile() ? '7px' : '9px',
        'line-height': 1.45,
        'list-style': 'none',
        margin: 0,
        padding: 0,
      }}
    >
      <li>
        <PlusMark /> People become <Hi>recipients</Hi>.
      </li>
      <li>
        <PlusMark /> Files become <Hi>attachments</Hi>.
      </li>
    </ul>
  ),
  // Nudge the compose graphic down so the panel's top edge lines up with the
  // "Feature 1.2" eyebrow in the copy column. Only in the side-by-side layout —
  // when stacked (breakpoint), the graphic sits under the copy so no offset.
  heroShot: () => (
    <div style={{ 'margin-top': breakpoint() ? '0px' : '78px' }}>
      <EmailComposeSpotlight />
    </div>
  ),
  heroBare: true,
};

// Copy-left / graphic-right feature section — used for the accounts, compose
// and AI stories. On desktop (>=1030px) the heading and body sit beside the
// graphic; at medium/narrow it gives way to a simple stacked column (copy above
// graphic) like the hero. Font sizes switch at the narrower mobile() breakpoint,
// matching the hero's type at medium.
function FeatureSplit(props: {
  block: LoopsFeatureBlock;
  reverse?: boolean;
  align?: 'center' | 'start';
  clampGraphic?: boolean;
  minHeight?: string;
}) {
  const stacked = () => breakpoint();
  // Clamp the graphic cell to the shared inbox aspect (880×348) so a taller
  // graphic (e.g. the AI phone) doesn't make its section taller than the others
  // — it overflows the cell instead, keeping a consistent section rhythm.
  const clamp = () => !!props.clampGraphic && !stacked();
  return (
    <div
      style={{
        'padding-top': mobile() ? '52px' : '84px',
        'padding-bottom': mobile() ? '96px' : '148px',
        'padding-inline': mobile() ? '18px' : '24px',
      }}
    >
      <section
        aria-label={props.block.label}
        style={{
          'align-items': stacked() ? 'start' : (props.align ?? 'center'),
          'box-sizing': 'border-box',
          display: 'grid',
          gap: stacked() ? '32px' : '56px',
          'grid-template-columns': stacked()
            ? 'minmax(0, 1fr)'
            : props.reverse
              ? 'minmax(0, 1.2fr) minmax(0, 1fr)'
              : 'minmax(0, 1fr) minmax(0, 1.2fr)',
          margin: '0 auto',
          'max-width': 'var(--page-max)',
          // A taller section (content packs to the top via align:start) so its
          // heading and the next section's heading can't share the screen. The
          // space below is intended to be filled by a graphic under the copy.
          'min-height': stacked() ? undefined : props.minHeight,
          width: '100%',
        }}
      >
        {/* Heading + body copy (right column when reversed; always first when
            stacked, so copy stays above the graphic on mobile) */}
        <div
          style={{
            display: 'grid',
            gap: mobile() ? '14px' : '18px',
            'grid-column': stacked() ? undefined : props.reverse ? '2' : '1',
            'justify-items': 'start',
          }}
        >
          <div
            style={{ display: 'grid', gap: '10px', 'justify-items': 'start' }}
          >
            <Show when={props.block.fig}>
              <FigLabel>{props.block.fig}</FigLabel>
            </Show>
            <h2
              style={{
                'font-family': 'display',
                'font-size': mobile() ? '32px' : '42px',
                'font-weight': '400',
                'letter-spacing': '-0.018em',
                'line-height': 1.1,
                margin: '0',
                'text-align': 'left',
              }}
            >
              {props.block.headline}
            </h2>
          </div>
          <p
            style={{
              color: 'var(--c4)',
              'font-family': 'body',
              'font-size': mobile() ? '17px' : '19px',
              'font-weight': '400',
              'line-height': 1.55,
              margin: '0',
              'max-width': '460px',
              'text-align': 'left',
            }}
          >
            {props.block.description}
          </p>
          {/* Optional third cell (e.g. compose's @-mention list) */}
          {props.block.footer}
        </div>
        {/* The section graphic (left column when reversed) */}
        <div
          style={{
            'aspect-ratio': clamp() ? '880 / 348' : undefined,
            'grid-column': stacked() ? undefined : props.reverse ? '1' : '2',
            'grid-row': stacked() ? undefined : '1',
            overflow: clamp() ? 'visible' : undefined,
            position: clamp() ? 'relative' : undefined,
            width: '100%',
          }}
        >
          <Show when={props.block.heroShot}>
            {(HeroShot) => (
              <div
                style={
                  clamp()
                    ? {
                        left: '0',
                        position: 'absolute',
                        right: '0',
                        top: '50%',
                        transform: 'translateY(-50%)',
                      }
                    : { width: '100%' }
                }
              >
                <Dynamic component={HeroShot()} />
              </div>
            )}
          </Show>
        </div>
      </section>
    </div>
  );
}

const aiBlock: LoopsFeatureBlock = {
  label: 'Macro Mail',
  fig: 'Feature 1.3',
  headline: <>Unified team-level memory for agents.</>,
  description:
    'BYO agents or use the embedded models with unified memory. Macro remembers everything you do across email, tasks, docs, sales, marketing and engineering. One system, one context.',
  heroShot: EmailAiSpotlight,
  heroBare: true,
};

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

// AI section: heading on top; below, the AI phone sits perfectly centre-stage
// (no faded backdrop) with the old subheader broken into callouts on the right,
// connected by orange SVG lines that overlap the phone part each describes.
// Automations graphic sits on the left. Stacks to one column at medium/narrow.
export function AiFeatureSection(
  props: { flushBottom?: boolean; hideFig?: boolean } = {}
) {
  return (
    <div
      style={{
        'padding-top': mobile() ? '52px' : '84px',
        'padding-bottom': props.flushBottom ? '0' : mobile() ? '48px' : '72px',
        'padding-inline': mobile() ? '18px' : '24px',
      }}
    >
      <style>{`
        .ai-feature-headline {
          white-space: nowrap;
        }
        @media (max-width: 699px) {
          .ai-feature-headline {
            white-space: normal;
          }
        }
      `}</style>
      <div
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          gap: mobile() ? '28px' : '48px',
          margin: '0 auto',
          'max-width': 'var(--page-max)',
          width: '100%',
        }}
      >
        {/* Header: heading + lede, then the phone figure below. */}
        <div
          class="ai-feature-copy"
          style={{
            display: 'grid',
            gap: mobile() ? '16px' : '20px',
            'justify-items': 'start',
          }}
        >
          <Show when={aiBlock.fig && !props.hideFig}>
            <FigLabel>{aiBlock.fig}</FigLabel>
          </Show>
          <h2
            class="ai-feature-headline"
            style={{
              'font-family': 'display',
              'font-size': mobile() ? '32px' : '42px',
              'font-weight': '360',
              'letter-spacing': '-0.018em',
              'line-height': 1.1,
              margin: '0',
              'max-width': '100%',
              'text-align': 'left',
              'white-space': mobile() ? 'normal' : 'nowrap',
            }}
          >
            {aiBlock.headline}
          </h2>
          <p
            class="ai-feature-lede"
            style={{
              color: 'var(--c4)',
              'font-family': 'cyberreader, body',
              'font-size': mobile() ? '15.5px' : '18px',
              'font-weight': '300',
              'line-height': mobile() ? 1.5 : 1.6,
              margin: '0',
              'max-width': mobile() ? '578px' : '750px',
              'text-align': 'left',
              'text-wrap': 'pretty',
            }}
          >
            {aiBlock.description}
          </p>
        </div>

        <AiComposeFigure />
      </div>
    </div>
  );
}

const unifiedBlock: LoopsFeatureBlock = {
  label: 'Macro',
  headline: (
    <>
      When you're ready:
      <br />
      the <span style={{ color: 'var(--a0)' }}>everything inbox.</span>
    </>
  ),
  description:
    'With unified inbox, chat, @mentions, pull requests, and agent tasks land in the same triage list as your email. ',
  href: '/',
  hrefLabel: 'Explore the Macro workspace',
  heroShot: UnifiedInboxPlayer,
  heroBare: true,
};

// ---------------------------------------------------------------------------
// Comparison table (Macro Mail vs Superhuman vs Outlook vs Gmail)
// ---------------------------------------------------------------------------

const comparisonColumns: ComparisonColumn[] = [
  { label: 'Macro Mail' },
  { label: 'Superhuman', logo: LogoSuperhuman },
  { label: 'Outlook', logo: LogoOutlook },
  { label: 'Gmail', logo: LogoGmail },
];

const comparisonRows: ComparisonRow[] = [
  {
    feature: 'Multiple accounts in one inbox',
    cells: [true, true, 'partial', 'partial'],
  },
  {
    feature: 'Keyboard-first design',
    cells: [true, true, 'partial', 'partial'],
  },
  {
    feature: 'Agents draft & send for you',
    cells: [true, 'partial', 'partial', 'partial'],
  },
  { feature: 'Free plan', cells: [true, false, true, true] },
  {
    feature: 'Email, chat & tasks in one place',
    cells: [true, false, 'partial', false],
  },
  {
    feature: 'Share email threads with your team',
    cells: [true, false, 'partial', false],
  },
  { feature: 'Split-screen multitasking', cells: [true, false, true, false] },
  {
    feature: 'AI with your whole workspace as context',
    cells: [true, false, false, false],
  },
  {
    feature: '@mention docs, people & tasks',
    cells: [true, false, false, false],
  },
  { feature: 'Shared team memory', cells: [true, false, false, false] },
  { feature: 'Open source', cells: [true, false, false, false] },
  { feature: 'Price / seat / month', cells: ['$40', '$40', '$32', '$14'] },
];

function ComparisonSection() {
  return (
    <section
      aria-label="How Macro Mail compares"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '14px' : '18px',
        'justify-items': 'center',
        'min-width': '0',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div
        style={{
          width: '100%',
          'max-width': '920px',
          'text-align': 'center',
          'margin-bottom': mobile() ? '10px' : '18px',
        }}
      >
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': mobile() ? '26px' : '32px',
            'font-weight': '410',
            'letter-spacing': '-0.015em',
            'line-height': 1.15,
            margin: 0,
          }}
        >
          How does Macro Mail stack up?
        </h2>
      </div>
      <div style={{ width: '100%', 'max-width': '920px', 'min-width': '0' }}>
        <ComparisonTable columns={comparisonColumns} rows={comparisonRows} />
      </div>
      <ComparisonLegend />
      <SectionFaq items={faqItems} embedded />
    </section>
  );
}

// ---------------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------------

const faqItems: FaqItem[] = [
  {
    q: 'Does Macro Mail work with Gmail?',
    a: (
      <>
        Yes. Macro Mail is an email client, not an email server. Connect your
        Google Workspace or Gmail account in about 30 seconds. Your mail is
        backfilled into Macro's database so search and AI can work quickly.
        Outlook and custom IMAP/SMTP support are coming soon.
      </>
    ),
  },
  {
    q: 'How is Macro Mail different from Superhuman?',
    a: (
      <>
        Macro Mail has the same j / k / e shortcuts and supports multiple
        accounts in one inbox. Your email also sits alongside chat, tasks, docs,
        and agents instead of in a separate app. Many users find they no longer
        need Superhuman.
      </>
    ),
  },
  {
    q: 'Is switching risky?',
    a: (
      <>
        No. There is nothing to migrate. Macro Mail is a client for your
        existing account, so your mail stays where it is and the j / k / e
        shortcuts work from day one. You can run it beside your current client
        for a week before deciding. The app is open source, so you can inspect
        how it handles your mail.
      </>
    ),
  },
  {
    q: 'Can I combine multiple email accounts?',
    a: (
      <>
        Yes. Connect each account and triage them in one inbox, or filter to an
        individual account when needed. Messages, @mentions, pull requests, and
        agent tasks appear alongside email.
      </>
    ),
  },
  {
    q: 'What does the AI actually do?',
    a: (
      <>
        It helps separate important messages from noise and drafts replies based
        on past threads with the recipient, rather than a generic template. You
        can revise the draft and send it from the inbox.
      </>
    ),
  },
  {
    q: 'Can I share an email thread with my team?',
    a: (
      <>
        Yes. Share a thread and your team can see the full conversation,
        including later replies. This avoids copying screenshots into chat to
        provide the missing context.
      </>
    ),
  },
  {
    q: 'Is Macro Mail open source?',
    a: (
      <>
        Yes. Like the rest of Macro, it is open source under the AGPLv3 at{' '}
        <a
          href="https://github.com/macro-inc/macro"
          target="_blank"
          rel="noreferrer"
        >
          github.com/macro-inc/macro
        </a>
        . Anyone can inspect or build on the code. This does not expose your
        data. Your email and workspace retain the same privacy and security
        protections as a traditional closed-source app.
      </>
    ),
  },
  dataSecurityFaqItem,
  {
    q: 'How much does Macro Mail cost?',
    a: (
      <>
        The free plan includes email, chat, docs, tasks, calls, and AI, with up
        to two connected email accounts plus storage and AI-use limits. The paid
        plan is $40 per seat per month and adds connected accounts, storage, and
        AI capacity. See <a href="/pricing">pricing</a>.
      </>
    ),
  },
];

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

function EmailFinalCta() {
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
          Reach inbox zero.
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
          It takes 30 seconds to connect an account. Macro Mail backfills your
          mail, splits signal from noise, and hands you the keyboard.
        </p>
      </div>
      <ConnectGoogleButton buttonName="email_final_connect_google" large />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteEmail: Component = () => {
  setPageSeo({
    title: 'Macro Mail — The AI Email Client',
    description:
      'Macro Mail combines the speed of Superhuman, the multitasking of Outlook, the intelligence of Claude, and the simplicity of Gmail in one keyboard-first inbox.',
    path: '/email',
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
          .email-cta-button:hover { transform: scale(1.02); }
        }
        ${loopsFeatureHoverStyles()}
      `}</style>

      {/* Hero — a quiet, left-aligned text column beside the signal/noise
          graphic. Sparser than the old centered stack: a single brand tag, one
          headline about separating signal from noise, one supporting line, and
          the CTA. On mobile it collapses to text-then-graphic. */}
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
            // 14px on desktop matches BaseHeader's inner padding, so the hero
            // content's left edge lines up with the header logo (both sit in the
            // same page-max-centered container).
            'padding-inline': mobile() ? '18px' : '14px',
            // Clear the fixed header's 126px fade so the eyebrow retains its
            // intended accent color on mobile.
            'padding-top': '132px',
            position: 'relative',
            'z-index': 1,
            width: '100%',
          }}
        >
          {/* A single left-aligned text column, held to the left edge of the
              content width. Deliberately sparse: brand tag, one headline about
              separating signal from noise, one supporting line, and the CTA. */}
          <div
            style={{
              'box-sizing': 'border-box',
              display: 'grid',
              gap: mobile() ? '20px' : '26px',
              // minmax(0, 1fr) keeps the single column from sizing to the
              // headline's max-content (its full width on one line), which would
              // otherwise blow the column past the viewport on narrow screens.
              'grid-template-columns': 'minmax(0, 1fr)',
              'justify-items': 'start',
              'max-width': '1160px',
              'text-align': 'left',
              width: '100%',
            }}
          >
            <HeroEyebrow label="Macro Mail" mobile={mobile} />
            <h1
              style={{
                'font-family': 'display',
                'font-size': mobile()
                  ? 'clamp(34px, 9vw, 46px)'
                  : 'clamp(48px, 4.6vw, 60px)',
                'font-weight': '380',
                'letter-spacing': '-0.014em',
                'line-height': 1.08,
                margin: '0',
              }}
            >
              Clear your inbox <em>faster</em>.
            </h1>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'body',
                'font-size': mobile() ? '16.5px' : '19px',
                'font-weight': '400',
                'line-height': 1.55,
                margin: '0',
                'max-width': mobile() ? '100%' : '46ch',
                'text-wrap': 'balance',
              }}
            >
              Macro Mail intelligently ranks your emails and learns what's
              important to <em>you</em>.
              <Show when={!mobile()}>
                {' '}
                Spend less time filtering and more time focusing.
              </Show>
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
              <ConnectGoogleButton buttonName="email_hero_connect_google" />
              <WatchDemoButton onClick={() => setHeroDemoOpen(true)} />
            </div>
          </div>
        </section>

        {/* Signal-vs-noise hero illustration, full-width below the text intro.
            On desktop the whole graphic is tilted in 3D so the smaller Signal
            window (on the right) rotates toward the viewer while the big inbox
            on the left recedes — plus a soft light pool + drop shadow so the
            windows lift off the near-black background. */}
        <div
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            'justify-items': 'center',
            'padding-block': mobile() ? '40px 24px' : '72px 56px',
            'padding-inline': mobile() ? '18px' : '24px',
            position: 'relative',
            // Nudge the whole graphic left (windows + glow move together) so its
            // left edge lines up with the hero text/logo. Tune this one value.
            transform: mobile()
              ? 'none'
              : 'translateX(-32px) translateY(-32px)',
            width: '100%',
            overflow: 'visible',
          }}
        >
          {/* Soft lightening pool behind the windows to make them pop. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              inset: mobile() ? '8% 0' : '-2% 0',
              background:
                'radial-gradient(56% 64% at 65% 44%, color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 4%, transparent) 42%, transparent 70%)',
              'pointer-events': 'none',
              'z-index': 0,
            }}
          />
          {/* Drop shadow lives on the outer wrapper (not the img) so the img's
              own mask doesn't clip it. The 3D is split for edge quality:
              perspective on the parent, rotate on the img child. The child
              rasterizes flat and the compositor then applies perspective, which
              keeps thin edges (e.g. the Signal card's orange rim) from
              resampling down to a shimmering hairline. Same 1800px distance and
              same tilt angles as before — only the render path changed. */}
          <div
            style={{
              filter: mobile()
                ? 'none'
                : 'drop-shadow(14px 4px 20px rgb(0 0 0 / 0.3)) drop-shadow(10px 0px 5px rgb(0 0 0 / 0.1))',
              position: 'relative',
              width: '100%',
              'max-width': '1100px',
              'z-index': 1,
            }}
          >
            <Show
              when={mobile()}
              fallback={
                <div style={{ perspective: '2400px', width: '100%' }}>
                  <img
                    src={heroSignalNoiseUrl}
                    alt="Macro Mail sorting a busy inbox into signal and noise"
                    draggable={false}
                    style={{
                      display: 'block',
                      height: 'auto',
                      'user-select': 'none',
                      '-webkit-user-select': 'none',
                      '-webkit-user-drag': 'none',
                      '-webkit-mask-image':
                        'linear-gradient(to bottom, #000 0%, #000 60%, transparent 100%)',
                      'mask-image':
                        'linear-gradient(to bottom, #000 0%, #000 60%, transparent 100%)',
                      transform: 'rotateX(10deg) rotateY(-8deg)',
                      'transform-origin': 'center center',
                      width: '100%',
                    }}
                  />
                </div>
              }
            >
              <MobileHeroInbox />
            </Show>
          </div>
        </div>
      </div>

      <HomeSectionRule />

      {/* Spend less time on email — one-line header + the interactive mockup. */}
      <EmailFilteringSection mobile={mobile} />

      <HomeSectionRule />

      {/* The fundamentals — single row of differentiators */}
      <EmailFeatureGrid />

      <HomeSectionRule />

      {/* Every account, one inbox — the multi-account email story leads */}
      <FeatureSplit block={accountsBlock} />

      <HomeSectionRule />

      {/* Compose + @mention — reversed: animating mockup left, copy right */}
      <FeatureSplit block={composeBlock} reverse align="start" />

      <HomeSectionRule />

      {/* AI drafting — clamp the tall phone to the shared section height */}
      <AiFeatureSection />

      {/* The workspace inbox — a closing "beyond email" bonus, not the lead */}
      <div
        style={{
          'padding-top': mobile() ? '52px' : '84px',
          'padding-bottom': mobile() ? '56px' : '80px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <LoopsFeatureSection
          block={unifiedBlock}
          textLayout={breakpoint() ? 'centered' : 'split'}
          spotlight
          spotlightGlow={0}
          spotlightMaxWidth="1160px"
        />
      </div>

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
        <EmailFinalCta />
      </div>

      {/* Divider + footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/email" footerOnly />
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
