import { type Component, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { viewportWidth } from '../../utils/utilBreakpoint';
import {
  CtaIcon,
  ctaHref,
  ctaLabel,
  handleCtaClick,
} from '../../utils/utilCta';
import { CollabHeadline } from './CollabHeadline';
import { HeroEyebrow } from './HeroEyebrow';
import { HomeSectionRule } from './HomeSectionRule';

// ---------------------------------------------------------------------------
// SectionFeatureLite
//
// The lightweight, blog-style top half of a feature page: a blog-index-style
// hero (serif headline + sub + CTAs), a grid of sub-feature "cards" that mirror
// the blog post cards (thin-rule grid, simple accent icon tile, uppercase
// title, short blurb), and an inline feature video below.
//
// Shared by /tasks, /channels and /documents so the three pages read
// identically. The competitor comparison, final CTA and footer stay in each
// route below this section.
// ---------------------------------------------------------------------------

const mobile = () => viewportWidth() < 700;

export type FeatureLiteCard = {
  /** SVG imported as a Solid component (mono, honours `currentColor`). */
  icon: Component<{ class?: string; style?: JSX.CSSProperties }>;
  title: string;
  desc: string;
};

export type FeatureLiteVideo =
  | { kind: 'youtube'; id: string }
  | { kind: 'mp4'; src: string; poster?: string };

/** Optional lead artwork shown beside the hero copy. `src` is an svg/png url. */
export type FeatureLiteGraphic = { src: string; alt: string };

/** Scoped hover/pseudo/responsive rules that inline styles can't express. */
export function featureLiteStyles(): string {
  return `
  /* Guarded on (hover) like the /tasks and /email CTA rules, so the lift
     doesn't stick after a tap on touch devices. */
  @media (hover) {
    .feat-lite-cta-primary:hover,
    .feat-lite-cta-secondary:hover { transform: scale(1.02); }
  }
  /* Carets, name pills and selections for the collaboratively-edited headline.
     Each belongs to one editor and is tinted with that editor's accent, from
     the same cast as the live-cursor mocks further down the page: --a0 for
     Julia, --a2 for Rahul. Decorative only — the headline is not editable.

     Every one of these is laid out so it cannot move the text it annotates.
     A caret carries no width: margin-right cancels both the bar and its own
     leading gap, so a caret advancing through the text can never tip a line
     break. It overhangs the cap height and baseline the way an editor caret
     clears the line it sits on, and holds steady rather than blinking, which
     pulled the eye off the words. */
  .feat-lite-title-caret {
    background-color: var(--a0);
    display: inline-block;
    height: 0.96em;
    margin-left: 0.05em;
    margin-right: calc(-0.05em - 2px);
    position: relative;
    vertical-align: -0.12em;
    width: 2px;
  }
  /* The editor's name, sat above their caret or selection. Absolutely
     positioned so it takes no space in the line, and sized in px rather than
     em: it is UI chrome borrowed from the app, not display type, so it should
     not scale up with a 60px headline. The clipped bottom-left corner is the
     same pill the live-cursor mocks use. */
  .feat-lite-title-tag {
    background-color: var(--a0);
    border-radius: 6px 6px 6px 0;
    bottom: 100%;
    color: var(--b0);
    font-family: body, system-ui, sans-serif;
    font-size: 13px;
    font-weight: 700;
    left: -1px;
    letter-spacing: 0.01em;
    line-height: 1;
    margin-bottom: 3px;
    padding: 4px 8px;
    position: absolute;
    white-space: nowrap;
  }
  /* Holds the headline open at its full two lines while the edits play. Every
     state of the sequence is two lines by construction, so this is a guard
     rather than a correction: nothing the animation renders may be shorter than
     the headline it settles on, or the sub, CTAs and hero artwork would ride up
     and drop back. 2lh is exactly two line boxes whatever the font-size
     resolves to; the em value is the same figure for browsers without lh, from
     the 1.08 line-height set on the h1 below. Dropped at rest, so resizing
     behaves normally once the animation is over. */
  .feat-lite-title-hold {
    min-height: 2.16em;
    min-height: 2lh;
  }
  /* A live selection over the run about to be edited. Both the highlight and
     the underline are absolutely positioned, so selecting a run cannot nudge
     the glyphs on either side of it — and so their bottom edge can be set
     independently of the font's em box: painting the highlight as the span's
     own background hung it a whole descender below letters that have none.
     0.14em pulls that slack up to sit just under the baseline; the 2px sides
     are the breathing room padding would have given. */
  .feat-lite-title-sel {
    position: relative;
  }
  .feat-lite-title-sel::before {
    background-color: color-mix(in srgb, var(--sel) 22%, transparent);
    border-radius: 6px;
    content: '';
    inset: -2px -2px 0.14em;
    pointer-events: none;
    position: absolute;
    z-index: -1;
  }
  /* The underline is its own square element rather than part of the highlight:
     rounded corners would curl its ends up into a shallow bowl, and it caps
     the highlight's raised bottom edge exactly — flat and taking no space in
     the line. Its ends stop where the highlight's 6px corners begin (the
     highlight reaches to -2px, so its flat bottom run starts 6px later, at
     +4px), so the bar spans only the straight edge instead of poking square
     ends into the curves.

     A real element rendered BEFORE the text, not an ::after. Anything
     positioned at the END of an inline box — generated content or a real
     child — makes the browser snap that box's advance width, and the rounding
     lands differently at each width, so the text after it shifted by up to
     1.3px on every step of the drag. Measured: identical markup with the bar
     leading instead of trailing moves the following text by 0.000px. The same
     is why the name pill is rendered ahead of the text. */
  .feat-lite-title-rule {
    background-color: var(--sel);
    border-radius: 0;
    bottom: 0.14em;
    height: 2px;
    left: 4px;
    position: absolute;
    right: 4px;
  }

  .feat-lite-video-frame { aspect-ratio: 16 / 9; }
  .feat-lite-video-frame iframe,
  .feat-lite-video-frame video {
    border: 0;
    display: block;
    height: 100%;
    width: 100%;
  }

  /* Card grid — thin rules between cells, matching the blog index. */
  .feat-lite-grid {
    --feat-rule: color-mix(in srgb, var(--b4) 22%, transparent);
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .feat-lite-card {
    border-top: 1px solid var(--feat-rule);
    min-width: 0;
    padding: 36px 0 0;
  }
  /*
   * The card's own geometry, in CSS rather than inline styles so the
   * prerendered HTML carries no viewport-signal value, and so a page can opt
   * into a roomier variant without the shared defaults moving under the pages
   * that did not ask for it.
   */
  .feat-lite-cards { padding: 36px 24px 12px; }
  .feat-lite-card-col { gap: 22px; }
  /* The well's skeuomorphic treatment, in CSS rather than inline styles so a
     variant can drop it without the shared default moving. */
  .feat-lite-card-media {
    background: color-mix(in oklch, var(--b2), var(--b0));
    border-radius: 14px;
    box-shadow:
      inset 0 0 0 1px rgba(255, 255, 255, 0.03),
      inset 0 1px 0 0 rgba(255, 255, 255, 0.04),
      0 0 0 1px rgba(0, 0, 0, 0.6),
      0 4px 4px 0 rgba(0, 0, 0, 0.1);
    height: 176px;
  }
  .feat-lite-card-text { gap: 10px; }
  /*
   * Roomy: the same content, given a great deal more room around it.
   *
   * The default well is a 1.85:1 letterbox spanning the full column, with a
   * 46px shape adrift in the middle of it. Roomy squares the well AND caps its
   * width, so the block of ink gets smaller rather than larger: 325x176
   * becomes 176x176, and the 149px it gives up becomes negative space beside
   * it. Every other value here is space, not size, which is what carries the
   * simplicity the section is claiming.
   */
  .feat-lite-cards-roomy { padding: 104px 24px 96px; }
  .feat-lite-grid-roomy .feat-lite-card-col { gap: 30px; }
  /* No card behind the shape. The 176px box stays as pure space: it is what
     holds the shape off its label and keeps the three columns aligned, and
     with nothing drawn it reads as air rather than as a panel.
     Width stated outright, not left to flex stretch with a max-width: an auto
     inline margin stops a flex item stretching on the cross axis, so the box
     would collapse to the 46px shape inside it and take the breathing room
     with it. */
  .feat-lite-grid-roomy .feat-lite-card-media {
    background: none;
    border-radius: 0;
    box-shadow: none;
    height: 176px;
    margin-inline: auto;
    width: 176px;
  }
  .feat-lite-grid-roomy .feat-lite-card-text {
    gap: 12px;
    text-align: center;
  }
  /* The measure stays capped; centring it is what keeps the slack even on
     both sides instead of pooling on the right. */
  .feat-lite-grid-roomy .feat-lite-card-text p {
    margin-inline: auto;
    max-width: 32ch;
  }
  .feat-lite-card:first-child { border-top: 0; padding-top: 0; }

  @media (min-width: 721px) {
    /* Equal-width columns separated by a gap; the divider is drawn centered
       in the gap so every card is the same width and the first/last cards
       still sit flush with the section edges. */
    .feat-lite-grid {
      column-gap: 68px;
      grid-template-columns: repeat(var(--feat-cols, 3), minmax(0, 1fr));
    }
    /* Same specificity as the rule above, so it has to sit after it. */
    .feat-lite-grid-roomy { column-gap: 96px; }
    /* The divider is offset by half the gap so it sits centred between two
       columns. -34px was centred in the default 68px gap; the roomy gap is 96. */
    .feat-lite-grid-roomy .feat-lite-card:not(:first-child)::before { left: -48px; }
    .feat-lite-card {
      border-top: 0;
      padding: 4px 0;
      position: relative;
    }
    .feat-lite-card:not(:first-child)::before {
      background: var(--feat-rule);
      bottom: 0;
      content: '';
      left: -34px;
      position: absolute;
      top: 0;
      width: 1px;
    }
  }

  /* Hero with a lead graphic. The art sits in the same section as the copy —
     no rule between them — so the headline, sub and artwork read as one unit.
     It stays stacked rather than sitting in a second column: the artwork is
     dense enough that a half-width column renders its body text below the
     legibility of the /tasks hero, which is the bar to match. Pages with no
     graphic get a one-column grid, laid out exactly like the plain block
     flow before it. */
  .feat-lite-hero {
    display: grid;
    /* This gap is the air between the CTAs and the artwork below them, since
       the copy column ends on the buttons. Generous on purpose: the CTAs are
       the hero's action and the artwork is dense, so they need clear separation
       rather than reading as one stack. */
    gap: 112px;
    grid-template-columns: minmax(0, 1fr);
  }
  /* Centred at 0.8 of the hero column, so the artwork sits as a figure under
     the copy rather than a full-bleed band — at 100% it crowded the headline
     and CTAs above it. The artwork carries its own width/height, so the img
     gets an intrinsic aspect ratio and reserves its box before it loads. */
  .feat-lite-hero-art {
    margin: 0 auto;
    min-width: 0;
    position: relative;
    width: 80%;
  }
  /* Full width on phones, where scaling down would push the artwork's body
     text under the legibility bar the /tasks hero sets. Matches the 700px
     mobile() breakpoint used for this section's inline styles. */
  @media (max-width: 699px) {
    .feat-lite-cards { padding: 32px 20px 8px; }
    .feat-lite-cards-roomy { padding: 64px 20px 56px; }
    .feat-lite-card-media { height: 150px; }
    .feat-lite-grid-roomy .feat-lite-card-media { height: 150px; width: 150px; }
    .feat-lite-hero-art { width: 100%; }
    /* Proportionally less on phones, where vertical space is dearer and the
       artwork already runs full width. */
    .feat-lite-hero { gap: 68px; }
  }
  /* Soft neutral bloom behind the art, same --c1 tint and stops as the /tasks
     hero backdrop. */
  .feat-lite-hero-art::before {
    background: radial-gradient(
      58% 62% at 50% 46%,
      color-mix(in srgb, var(--ambient-ink) 5%, transparent) 0%,
      color-mix(in srgb, var(--ambient-ink) 4%, transparent) 42%,
      transparent 70%
    );
    content: '';
    inset: -14% -10%;
    pointer-events: none;
    position: absolute;
    z-index: 0;
  }
  .feat-lite-hero-art img {
    display: block;
    filter: drop-shadow(0 26px 50px rgb(0 0 0 / 0.55));
    height: auto;
    position: relative;
    width: 100%;
    z-index: 1;
  }

  .feat-lite-hero-wrap { position: relative; }
  .feat-lite-hero-wrap > section { position: relative; z-index: 1; }
  /* Keep the figure's ambient light local, fading to the black page. */
  .feat-lite-hero-lit::after {
    background: radial-gradient(
      ellipse 45% 40% at 50% 70%,
      color-mix(in srgb, var(--ambient-ink) 8%, transparent),
      transparent 100%
    );
    bottom: 0;
    content: '';
    height: 60%;
    left: 0;
    pointer-events: none;
    position: absolute;
    width: 100%;
    z-index: 0;
  }
  `;
}

// Both CTAs follow the home page's pill language, matching the /tasks and
// /email heroes exactly: the primary is the same `--c1` pill as the header and
// final "Get started" buttons, and the secondary is the quiet bordered pill of
// the hero's GitHub-stars button.
function PrimaryCta(props: { buttonName: string }) {
  return (
    <a
      href={ctaHref()}
      class="feat-lite-cta-primary"
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
        'font-size': '14px',
        'font-weight': '700',
        gap: '7px',
        height: '30px',
        'justify-content': 'center',
        'letter-spacing': '0.01em',
        'line-height': 1,
        padding: '0 18px',
        'text-decoration': 'none',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
      }}
    >
      <CtaIcon size={15} opacity={0.9} />
      {ctaLabel('Connect with Google')}
    </a>
  );
}

function SecondaryCta() {
  return (
    <a
      href="#feature-video"
      class="feat-lite-cta-secondary"
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
        'text-decoration': 'none',
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
    </a>
  );
}

function FeatureVideo(props: { video: FeatureLiteVideo; label: string }) {
  return (
    <div
      class="feat-lite-video-frame"
      style={{
        background: 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--b4) 40%, transparent)',
        'border-radius': '14px',
        'box-shadow': 'var(--shadow-window)',
        overflow: 'hidden',
        width: '100%',
      }}
    >
      <Show
        when={props.video.kind === 'youtube'}
        fallback={
          <video
            controls
            playsinline
            preload="metadata"
            poster={props.video.kind === 'mp4' ? props.video.poster : undefined}
          >
            <source
              src={props.video.kind === 'mp4' ? props.video.src : undefined}
              type="video/mp4"
            />
          </video>
        }
      >
        <iframe
          src={`https://www.youtube.com/embed/${props.video.kind === 'youtube' ? props.video.id : ''}?rel=0`}
          title={props.label}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen
        />
      </Show>
    </div>
  );
}

// The sub-feature card grid, exported on its own so pages with a custom hero
// (e.g. /channels) can keep the shared card language below it. Requires
// featureLiteStyles() to be included in the page's <style>.
export function FeatureLiteCards(props: {
  cardsLabel?: string;
  cardsRoomy?: boolean;
  cards: FeatureLiteCard[];
}) {
  const columns = () => Math.min(props.cards.length, 3);
  return (
    <section
      class={`feat-lite-cards${props.cardsRoomy ? ' feat-lite-cards-roomy' : ''}`}
      style={{
        'box-sizing': 'border-box',
        margin: '0 auto',
        'max-width': '1280px',
        width: '100%',
      }}
    >
      <Show when={props.cardsLabel}>
        <p
          style={{
            color: 'color-mix(in srgb, var(--c4) 70%, transparent)',
            'font-family': 'rajdhani, body, system-ui, sans-serif',
            'font-size': '14px',
            'font-weight': '600',
            'letter-spacing': '0.12em',
            margin: '0 0 30px',
            'text-transform': 'uppercase',
          }}
        >
          {props.cardsLabel}
        </p>
      </Show>

      <ul
        class={`feat-lite-grid${props.cardsRoomy ? ' feat-lite-grid-roomy' : ''}`}
        style={{
          'list-style': 'none',
          margin: '0',
          padding: '0',
          '--feat-cols': String(columns()),
        }}
      >
        <For each={props.cards}>
          {(card) => (
            <li class="feat-lite-card">
              <div
                class="feat-lite-card-col"
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  height: '100%',
                }}
              >
                <div
                  aria-hidden="true"
                  class="feat-lite-card-media"
                  style={{
                    'align-items': 'center',
                    color: 'var(--a0)',
                    display: 'flex',
                    'justify-content': 'center',
                  }}
                >
                  <card.icon style={{ height: '46px', width: '46px' }} />
                </div>
                <div class="feat-lite-card-text" style={{ display: 'grid' }}>
                  <h2
                    style={{
                      color: 'var(--c2)',
                      'font-family': 'body, system-ui, sans-serif',
                      'font-size': '18px',
                      'font-weight': '700',
                      'letter-spacing': '0.07em',
                      'line-height': '1.2',
                      margin: '0',
                      'text-transform': 'uppercase',
                      'text-wrap': 'balance',
                    }}
                  >
                    {card.title}
                  </h2>
                  <p
                    style={{
                      color: 'color-mix(in srgb, var(--c4) 70%, transparent)',
                      'font-family': 'body, system-ui, sans-serif',
                      'font-size': '16px',
                      'font-weight': '600',
                      'line-height': '1.5',
                      'margin-block': '0',
                    }}
                  >
                    {card.desc}
                  </p>
                </div>
              </div>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

// The inline feature video, exported alongside FeatureLiteCards for pages
// composing the section themselves.
export function FeatureLiteVideoSection(props: {
  video: FeatureLiteVideo;
  videoLabel: string;
  videoCaption?: string;
}) {
  return (
    <>
      <HomeSectionRule />
      <section
        id="feature-video"
        style={{
          'box-sizing': 'border-box',
          margin: '0 auto',
          'max-width': '1280px',
          padding: mobile() ? '44px 20px 8px' : '72px 24px 12px',
          'scroll-margin-top': '90px',
          width: '100%',
        }}
      >
        <Show when={props.videoCaption}>
          <p
            style={{
              color: 'color-mix(in srgb, var(--c4) 70%, transparent)',
              'font-family': 'rajdhani, body, system-ui, sans-serif',
              'font-size': '14px',
              'font-weight': '600',
              'letter-spacing': '0.12em',
              margin: '0 0 22px',
              'text-align': 'center',
              'text-transform': 'uppercase',
            }}
          >
            {props.videoCaption}
          </p>
        </Show>
        <FeatureVideo video={props.video} label={props.videoLabel} />
      </section>
    </>
  );
}

export function SectionFeatureLite(props: {
  eyebrow: string;
  headline: JSX.Element;
  sub: JSX.Element;
  ctaButtonName: string;
  cardsLabel?: string;
  /** Squarer media wells and wider gaps around the card text. */
  cardsRoomy?: boolean;
  cards: FeatureLiteCard[];
  graphic?: FeatureLiteGraphic;
  /** Renders in the hero's figure slot instead of `graphic`, for a live
   * component (the embedded editor) rather than a static image. Takes the same
   * 80%-width, bloom-backed treatment the artwork gets. */
  heroFigure?: Component;
  /**
   * Types the headline in on mount, one line per entry, leaving a caret
   * blinking after it. Replaces `headline` when set — pass the same lines to
   * both so the static and animated headings can't drift apart.
   */
  typedLines?: string[];
  /** Optional section rendered between the hero and the sub-feature cards. */
  afterHero?: JSX.Element;
  /** Omit to drop the inline video section, its section rule, and the hero's
   * "Watch demo" button, which exists only to jump to it. */
  video?: FeatureLiteVideo;
  videoLabel?: string;
  videoCaption?: string;
}) {
  return (
    <>
      {/* ---- Blog-style hero -------------------------------------------- */}
      {/* The rise is lit whenever the hero carries a figure of any kind —
          keyed on graphic OR heroFigure, since a live component fills the same
          slot and needs the same ground behind it. */}
      <div
        class={`feat-lite-hero-wrap${props.graphic || props.heroFigure ? ' feat-lite-hero-lit' : ''}`}
      >
        <section
          style={{
            'box-sizing': 'border-box',
            margin: '0 auto',
            'max-width': '1280px',
            padding: mobile() ? '96px 20px 40px' : '116px 24px 56px',
            width: '100%',
          }}
        >
          <div class="feat-lite-hero">
            <div style={{ 'min-width': '0' }}>
              <HeroEyebrow label={props.eyebrow} mobile={mobile} />
              <h1
                // A typed headline mutates its text on every tick, so the
                // accessible name comes from here instead — one stable title.
                aria-label={
                  props.typedLines ? props.typedLines.join(' ') : undefined
                }
                style={{
                  color: 'var(--c1)',
                  // Hints the title-field affordance without being editable.
                  cursor: props.typedLines ? 'text' : undefined,
                  'font-family': 'display, Georgia, serif',
                  'font-size': mobile()
                    ? 'clamp(38px, 11vw, 52px)'
                    : 'clamp(44px, 6vw, 60px)',
                  // The h1 weight main settled the slab on: the home hero and
                  // .tasks-h1 both set 360, and this clamp tops out at the same
                  // 60px they do, so it is the same tier and takes the same
                  // number rather than a value of its own.
                  'font-weight': '360',
                  'letter-spacing': 'normal',
                  'line-height': '1.08',
                  margin: mobile() ? '16px 0 0' : '18px 0 0',
                  // The collaboratively-edited headline passes through a
                  // longer line than it ends on: "Markdown documents.", before
                  // it is trimmed to "markdown docs.". Once the typed prefix
                  // takes line one, that title has to fit on ONE line or the
                  // hero grows a third line mid-edit and shoves the sub and
                  // artwork down. 12.4em is the window: wide enough for the
                  // untrimmed title (12.06em), still narrow enough that the
                  // prefix breaks the line before "Markdown" (12.88em), which
                  // is the bump the animation is built around. Both resting
                  // lines are far shorter, so this is invisible at rest.
                  'max-width': props.typedLines ? '12.4em' : '18ch',
                }}
              >
                <Show when={props.typedLines} fallback={props.headline}>
                  {(lines) => <CollabHeadline lines={lines()} />}
                </Show>
              </h1>
              <p
                style={{
                  // Main's lead tier, taken whole: cyberreader at its real
                  // Light 300 -- a discrete file, not a synthesised weight --
                  // on --c4 at full strength.
                  //
                  // The 78% mix belonged to the 600, which was synthetic bold
                  // over Rajdhani Medium, the only weight that family ships.
                  // Holding a transparency meant for a bolded face under one
                  // 300 units lighter would leave the sub too faint to read as
                  // the headline's second half, so it goes back to the flat
                  // --c4 that .tasks-lead uses.
                  //
                  // 'body' stays behind cyberreader as a fallback: with
                  // font-display: swap a failed load would otherwise drop to
                  // the generic sans rather than to Rajdhani.
                  color: 'var(--c4)',
                  'font-family': 'cyberreader, body, system-ui, sans-serif',
                  'font-size': mobile() ? '17px' : '20px',
                  'font-weight': '300',
                  'line-height': '1.6',
                  margin: '18px 0 0',
                  'max-width': '52ch',
                }}
              >
                {props.sub}
              </p>
              {/* Wraps rather than stacking full-width on mobile: these are the
                  same compact pills /tasks and /email use, which sit side by side
                  at every width. */}
              <div
                style={{
                  'align-items': 'center',
                  display: 'flex',
                  'flex-wrap': 'wrap',
                  gap: '14px',
                  'margin-top': mobile() ? '24px' : '30px',
                }}
              >
                <PrimaryCta buttonName={props.ctaButtonName} />
                <Show when={props.video}>
                  <SecondaryCta />
                </Show>
              </div>
            </div>
            <Show
              when={props.heroFigure}
              fallback={
                <Show when={props.graphic}>
                  {(graphic) => (
                    <div class="feat-lite-hero-art">
                      <img
                        src={graphic().src}
                        alt={graphic().alt}
                        draggable={false}
                      />
                    </div>
                  )}
                </Show>
              }
            >
              {(figure) => (
                <div class="feat-lite-hero-art">
                  <Dynamic component={figure()} />
                </div>
              )}
            </Show>
          </div>
        </section>
      </div>

      {/* ---- Optional section between the hero and the cards ------------ */}
      <Show when={props.afterHero}>
        <HomeSectionRule />
        {props.afterHero}
      </Show>

      <HomeSectionRule />

      {/* ---- Sub-feature cards ------------------------------------------ */}
      <FeatureLiteCards
        cardsLabel={props.cardsLabel}
        cardsRoomy={props.cardsRoomy}
        cards={props.cards}
      />

      {/* ---- Inline feature video --------------------------------------- */}
      {/* Same 1280px cap and inline padding as the hero and card sections
          above, so the video lands on exactly the content width the rest of
          the page uses rather than sitting in a narrower column of its own.
          The section rule belongs inside this Show: without it, a page that
          omits the video would render two rules back to back. */}
      <Show when={props.video}>
        {(video) => (
          <FeatureLiteVideoSection
            video={video()}
            videoLabel={props.videoLabel ?? 'Feature demo'}
            videoCaption={props.videoCaption}
          />
        )}
      </Show>
    </>
  );
}
