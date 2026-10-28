/*
 * /migrate leads with the content a company wants to bring over. MigrationPaths
 * explains the import routes; detailed comparisons live on product pages. Keep import
 * guidance aligned with the authenticated app and import pipeline.
 */
import CaretDown from '@phosphor/caret-down.svg';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { isServer } from 'solid-js/web';
import markDesyncPlaceholder from '../../assets/mark-desync-placeholder.jpg';
import markAvatar from '../../assets/people/mark.jpeg';
import { FeatureComparisons } from '../../features/marketing/components/comparisons/FeatureComparisons';
import { migrationComparisons } from '../../features/marketing/core/migration-comparisons';
import { ModuleGraphic } from '../components/graphics/ModuleGraphic';
import { MODULE_LOGOS } from '../components/graphics/moduleLogos';
import { SetupGraphic } from '../components/graphics/SetupGraphic';
import { HomeHeroBackdrop } from '../components/sections/HomeAppPreview';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import { MigrationPaths } from '../components/sections/MigrationPaths';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { APP_BASE_URL } from '../utils/utilBaseUrl';
import { viewportWidth } from '../utils/utilBreakpoint';
import { ctaHref, demoHref, handleCtaClick } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';

const mobile = () => viewportWidth() < 700;

const isLocalhost =
  !isServer && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const desyncVideoUrl = isLocalhost
  ? '/video/desync.mp4'
  : new URL('/video/desync.mp4', APP_BASE_URL).toString();

const DEMO_CALL_HREF = demoHref();

const DOCS = 'https://docs.macro.com';
const DOCS_SWITCH = `${DOCS}/switch-to-macro`;

// The five brand marks, in the order the hero scene's slots carry them.
const MODULE_ROW = [
  MODULE_LOGOS.Linear,
  MODULE_LOGOS.Google,
  MODULE_LOGOS.GitHub,
  MODULE_LOGOS.Notion,
  MODULE_LOGOS.Slack,
];

// ---------------------------------------------------------------------------
// Shared styles and small pieces
// ---------------------------------------------------------------------------

const sectionShell = (): JSX.CSSProperties => ({
  'box-sizing': 'border-box',
  display: 'grid',
  'justify-items': 'center',
  'padding-block': mobile() ? '72px' : '116px',
  'padding-inline': mobile() ? '18px' : '24px',
  width: '100%',
});

const columnStyle = (): JSX.CSSProperties => ({
  'box-sizing': 'border-box',
  display: 'grid',
  gap: mobile() ? '32px' : '44px',
  'max-width': '820px',
  'min-width': '0',
  width: '100%',
});

const bodyStyle = (): JSX.CSSProperties => ({
  color: 'var(--c4)',
  'font-family': 'Inter, body',
  'font-size': mobile() ? '14px' : '15px',
  'line-height': 1.75,
  margin: '0',
  'text-wrap': 'pretty',
});

function BookCallButton(props: { large?: boolean; label?: string }) {
  return (
    <a
      href={DEMO_CALL_HREF}
      target="_blank"
      rel="noreferrer"
      class="migrate-cta-button"
      style={{
        'align-items': 'center',
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--c4) 32%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': mobile() ? '15px' : props.large ? '15px' : '16px',
        'font-weight': '700',
        height: mobile() ? '40px' : props.large ? '46px' : '40px',
        'justify-content': 'center',
        'letter-spacing': '0.045em',
        'line-height': 1,
        padding: mobile() ? '0 20px' : props.large ? '0 26px' : '0 20px',
        'text-decoration': 'none',
        'text-transform': 'uppercase',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
        width: mobile() ? '100%' : 'max-content',
      }}
    >
      {props.label ?? 'Talk to us'}
    </a>
  );
}

function SectionHeading(props: {
  eyebrow?: string;
  title: string;
  children?: JSX.Element;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: mobile() ? '16px' : '20px',
        'justify-items': 'center',
        'max-width': '680px',
        'text-align': 'center',
      }}
    >
      <Show when={props.eyebrow}>
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'Inter, body',
            'font-size': mobile() ? '12px' : '15px',
            'letter-spacing': '0.08em',
            'text-transform': 'uppercase',
          }}
        >
          {props.eyebrow}
        </span>
      </Show>
      <h2
        style={{
          color: 'var(--c1)',
          'font-family': 'display',
          'font-size': mobile() ? '30px' : '42px',
          'font-weight': 'calc(315 + var(--cream-slab-weight-increase, 0))',
          'letter-spacing': '-0.015em',
          'line-height': 1.1,
          margin: 0,
          'text-wrap': 'balance',
        }}
      >
        {props.title}
      </h2>
      <Show when={props.children}>
        <p
          style={{
            ...bodyStyle(),
            'max-width': '620px',
            'text-wrap': 'balance',
          }}
        >
          {props.children}
        </p>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desync case study — wide video + Mark quote as figcaption
// ---------------------------------------------------------------------------

function DesyncCaseStudy() {
  let videoRef!: HTMLVideoElement;
  let playButtonRef: HTMLButtonElement | undefined;
  const [playing, setPlaying] = createSignal(false);

  async function handlePlay(fromKeyboard: boolean) {
    try {
      await videoRef.play();
      setPlaying(true);
      if (fromKeyboard) videoRef.focus();
    } catch {
      setPlaying(false);
    }
  }

  function resetPlayback() {
    const restoreFocus = document.activeElement === videoRef;
    setPlaying(false);
    if (restoreFocus) queueMicrotask(() => playButtonRef?.focus());
  }

  return (
    <section
      aria-label="Desync case study"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '36px 48px' : '72px',
        'padding-inline': mobile() ? '18px' : '24px',
        position: 'relative',
        width: '100%',
        'z-index': 0,
      }}
    >
      {/* Background matching the Case studies section on the /tasks page */}
      <div
        aria-hidden="true"
        style={{
          'background-color': 'var(--b0)',
          'background-image':
            'linear-gradient(to bottom, color-mix(in srgb, var(--c1) 16%, transparent) 0, transparent 1px), ' +
            'radial-gradient(70% 22% at 50% 0%, color-mix(in srgb, var(--ambient-ink) 7%, transparent) 0%, color-mix(in srgb, var(--ambient-ink) 1.6%, transparent) 60%, transparent 100%)',
          bottom: 0,
          left: '50%',
          'margin-left': '-50%',
          'pointer-events': 'none',
          position: 'absolute',
          top: 0,
          width: '100%',
          'z-index': -1,
        }}
      />

      <div
        style={{
          display: 'grid',
          'justify-items': 'center',
          position: 'relative',
          width: '100%',
          'z-index': 1,
        }}
      >
        <div class="migrate-case-video">
          <video
            ref={videoRef}
            controls={playing()}
            tabIndex={playing() ? 0 : -1}
            aria-label="Desync case study video"
            onEnded={resetPlayback}
            onError={resetPlayback}
            playsinline
            poster={markDesyncPlaceholder}
            preload="metadata"
            src={desyncVideoUrl}
            style={{ 'object-fit': playing() ? 'contain' : 'cover' }}
          />
          <Show when={!playing()}>
            <button
              ref={playButtonRef}
              type="button"
              class="migrate-case-play-trigger"
              aria-label="Play Desync case study"
              onClick={(event) => void handlePlay(event.detail === 0)}
            />
            <img
              src={markDesyncPlaceholder}
              loading="lazy"
              alt=""
              aria-hidden="true"
              class="migrate-case-poster"
            />
            <div class="migrate-case-scrim" aria-hidden="true" />
            <div class="migrate-case-heading">
              <h2 class="migrate-case-title">Case study</h2>
              <p class="migrate-case-subtitle">A company switches to Macro</p>
            </div>
            <aside
              class="migrate-case-quote"
              aria-label="Quote from Mark Evgenev"
            >
              <div class="migrate-case-quote-author">
                <img src={markAvatar} alt="" aria-hidden="true" />
                <span>
                  <strong>Mark Evgenev</strong>
                  <small>Founder/CEO, Desync</small>
                </span>
              </div>
              <blockquote>
                &ldquo;Macro did not help us get organized. Macro is why we are
                organized.&rdquo;
              </blockquote>
            </aside>
            <div class="migrate-case-play" aria-hidden="true">
              <svg
                width={mobile() ? '42' : '48'}
                height={mobile() ? '42' : '48'}
                viewBox="0 0 48 48"
              >
                <circle
                  cx="24"
                  cy="24"
                  r="21"
                  fill="none"
                  stroke="var(--c1)"
                  stroke-width="2"
                />
                <path d="M20.5 16.5 L20.5 31.5 L32.5 24 Z" fill="var(--c1)" />
              </svg>
              <span>Watch case study</span>
              <span class="migrate-case-play-rule" />
            </div>
          </Show>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export const RouteMigrate: Component = () => {
  setPageSeo({
    title: 'Switch your company to Macro | Migration guide',
    description:
      'Bring your company’s email, files, docs, tasks, and conversations into Macro. Explore imports, connected tools, and help from our team.',
    path: '/migrate',
  });

  return (
    <div
      lang="en"
      class="migrate-page"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '0',
        'grid-template-columns': 'minmax(0, 1fr)',
        'padding-bottom': mobile() ? '48px' : '64px',
        width: '100%',
      }}
    >
      <style>{`
        .migrate-page { --a0: var(--c1); }
        .migrate-hero-graphic, .migrate-module-graphic { filter: grayscale(1); }
        .migrate-hero-graphic .supermodule-cta-headline { font-size: 26px; letter-spacing: 0.03em; }
        .migrate-page :focus-visible { outline: 2px solid var(--c1); outline-offset: 4px; }
        .migrate-full-comparison { width: 100%; max-width: 980px; min-width: 0; }
        .migrate-full-comparison h2 { font-family: display; font-size: clamp(28px, 4vw, 40px); font-weight: calc(315 + var(--cream-slab-weight-increase, 0)); letter-spacing: -0.015em; margin: 0 0 16px; }
        .migrate-page .migrate-full-comparison .feature-comparisons { width: 100%; max-width: none; margin: 0; --comparison-header-size: 15px; --comparison-header-padding: 20px 10px; }
        .migrate-connected-tools { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 24px; width: 100%; max-width: 760px; justify-items: center; }
        .migrate-agent-prompt { max-width: 660px; margin: 0; padding: 4px 0 4px 24px; border-left: 2px solid var(--c4); color: var(--c2); font: 400 20px/1.55 Inter, body; text-wrap: pretty; }
        .migrate-practical-faq details { border-bottom: 1px solid var(--b2); padding: 20px 0; }
        .migrate-practical-faq summary { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; list-style: none; color: var(--c2); font: 500 16px/1.5 Inter, body; }
        .migrate-practical-faq summary::-webkit-details-marker { display: none; }
        .migrate-practical-faq summary > svg { width: 16px; height: 16px; flex: none; margin-top: 4px; color: var(--c4); transition: transform 160ms; }
        .migrate-practical-faq details[open] > summary > svg { transform: rotate(180deg); }
        .migrate-practical-faq p { color: var(--c4); font: 400 15px/1.75 Inter, body; margin: 16px 0 0; }
        .migrate-practical-faq a { color: var(--c2); text-decoration: underline; text-underline-offset: 3px; }
        @media (max-width: 699px) { .migrate-connected-tools { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; } .migrate-agent-prompt { font-size: 17px; padding-left: 16px; } }
        .migrate-scroll-hint { color: var(--c4); font-family: Inter, body; font-size: 12px; margin: 12px 0 0; }
        @media (hover) {
          .migrate-cta-button:hover { transform: scale(1.02); }
        }
        .migrate-hero-graphic, .migrate-module-graphic { display: block; height: auto; width: 100%; }
        .migrate-world-table-scroll,
        .comparison-table-scroll {
          scrollbar-color: var(--a0) transparent;
          scrollbar-width: thin;
        }
        .migrate-world-table-scroll::-webkit-scrollbar,
        .comparison-table-scroll::-webkit-scrollbar {
          height: 4px;
        }
        .migrate-world-table-scroll::-webkit-scrollbar-track,
        .comparison-table-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .migrate-world-table-scroll::-webkit-scrollbar-thumb,
        .comparison-table-scroll::-webkit-scrollbar-thumb {
          background: var(--a0);
          border-radius: 999px;
        }

        /* Greys throughout this page's plate chrome are mixed from --c4 (ink), not
           taken off the --b* scale: that scale is not ordered by lightness in
           every theme — under Macro, --b3 sits at 0.10 against a 0.14 background,
           i.e. darker than the surface it's drawn on, which reads as black. Mixing
           ink toward transparent always lands between the text and the
           background, whichever way the theme runs. */

        /* The wash band spans the graphic card and the testimonials and ends with
           them, so the case study video below sits on plain background — that
           hard stop is the divide between the two.

           It rides as a background *image*, which paints behind every child, so
           there's no stacking or pointer-events juggling over a scene that has to
           stay clickable. Strongest at the bottom edge, carrying up through the
           testimonials to light them, and all but gone about a quarter of the way
           up the card.

           The stops are percentages of this band, so they depend on the two
           blocks' proportion. Measured at desktop width: band 1222px, card 956px,
           so the testimonials are the bottom ~22% and a quarter of the way up the
           card lands at ~41%. Hence 22% is still clearly lit — that is the card's
           lower edge — and 41% is where it goes very faint. Retune if either
           block's height changes much; they are easy to get wrong by eye,
           since a stop that is a little low reads as the wash not reaching the
           card at all. */
        .migrate-washband {
          display: grid;
          justify-items: center;
          position: relative;
          width: 100%;
        }
        /* Keep the wash within the centered page column. */
        .migrate-washband::before {
          background-image: linear-gradient(
            to top,
            color-mix(in srgb, var(--c4) 3.5%, transparent) 0%,
            color-mix(in srgb, var(--c4) 2.8%, transparent) 12%,
            color-mix(in srgb, var(--c4) 1.8%, transparent) 22%,
            color-mix(in srgb, var(--c4) 0.4%, transparent) 41%,
            transparent 58%
          );
          content: '';
          inset-block: 0;
          left: 50%;
          pointer-events: none;
          position: absolute;
          transform: translateX(-50%);
          width: 100%;
          z-index: 0;
        }
        /* The wash is a positioned sibling, so it would otherwise paint over the
           in-flow illustration. Lift them above it rather than pushing it to
           a negative z-index, which would drop it behind the section backdrop. */
        .migrate-washband > * {
          position: relative;
          z-index: 1;
        }

        /* An unframed illustration lets the migration scene float over the wash
           and gives it more room than the former technical-card treatment. */
        .migrate-graphic-card {
          box-sizing: border-box;
          margin-bottom: 56px;
          max-width: 840px;
          padding-top: 38px;
          position: relative;
          width: 100%;
        }

        /* Keep the illustration close to the 760px intro copy column. */
        .migrate-figure {
          max-width: 840px;
          position: relative;
          width: 100%;
        }
        .migrate-hero-graphic {
          /* Transforms don't affect layout; matching the upward lift here makes
             the CTA overlap the illustration at its visual midpoint. */
          margin-bottom: -60px;
          transform: translate(46px, -60px);
        }

        @media (max-width: 700px) {
          .migrate-graphic-card { margin-bottom: 28px; padding-top: 32px; }
          .migrate-hero-graphic { transform: translateY(-60px); }
        }
        /* Desync case study — same breakout pattern as .mvn-video on the
           versus posts, but wider so it reads as a hero media beat. */
        .migrate-case-title {
          color: var(--c1);
          font-family: display, serif;
          font-size: 32px;
          font-weight: calc(400 + var(--cream-slab-weight-increase, 0));
          letter-spacing: -0.025em;
          line-height: 1.1;
          margin: 0 0 6px;
          text-align: left;
          text-wrap: balance;
        }
        .migrate-case-subtitle {
          color: var(--c4);
          font-family: Inter, body;
          font-size: 16px;
          line-height: 1.45;
          margin: 0 0 20px;
          text-align: left;
        }
        .migrate-case-video {
          aspect-ratio: 16 / 9;
          background: var(--b1);
          border: 1px solid color-mix(in srgb, var(--c1) 12%, transparent);
          border-radius: 18px;
          box-shadow: 0 28px 64px -22px rgb(0 0 0 / 0.66), 0 8px 24px -12px rgb(0 0 0 / 0.5);
          margin: 0 0 18px;
          max-width: 1120px;
          overflow: hidden;
          position: relative;
          width: 100%;
        }
        @media (max-width: 699px) {
          .migrate-case-video {
            border-radius: 14px;
          }
        }
        .migrate-case-play-trigger {
          position: absolute;
          inset: 0;
          z-index: 3;
          width: 100%;
          height: 100%;
          padding: 0;
          border: 0;
          border-radius: inherit;
          background: transparent;
          color: inherit;
        }
        .migrate-case-play-trigger:focus-visible {
          outline: 2px solid var(--c1);
          outline-offset: -4px;
        }
        .migrate-case-video video {
          background: var(--b1);
          border: 0;
          display: block;
          height: calc(100% + 2px);
          left: -1px;
          object-fit: cover;
          position: absolute;
          top: -1px;
          width: calc(100% + 2px);
        }
        .migrate-case-poster {
          display: block;
          filter: brightness(0.9);
          height: calc(100% + 2px);
          left: -1px;
          object-fit: cover;
          object-position: center center;
          pointer-events: none;
          position: absolute;
          top: -1px;
          width: calc(100% + 2px);
        }
        .migrate-case-scrim {
          background: linear-gradient(0deg, oklch(from var(--b0) l c h / 0.78), oklch(from var(--b0) l c h / 0.12) 52%, transparent 78%);
          inset: 0;
          pointer-events: none;
          position: absolute;
          z-index: 1;
        }
        .migrate-case-heading {
          left: 28px;
          pointer-events: none;
          position: absolute;
          top: 28px;
          z-index: 2;
        }
        .migrate-case-quote {
          backdrop-filter: blur(22px) saturate(150%);
          -webkit-backdrop-filter: blur(22px) saturate(150%);
          background:
            linear-gradient(
              135deg,
              color-mix(in srgb, var(--c1) 16%, transparent) 0%,
              color-mix(in srgb, var(--b0) 66%, transparent) 42%,
              color-mix(in srgb, var(--c1) 5%, transparent) 100%
            );
          border: 1px solid color-mix(in srgb, var(--c1) 20%, transparent);
          border-radius: 12px;
          box-shadow:
            0 18px 42px rgb(0 0 0 / 0.3);
          box-sizing: border-box;
          display: grid;
          gap: 14px;
          margin: 0;
          max-width: 340px;
          padding: 16px;
          pointer-events: none;
          position: absolute;
          right: 28px;
          top: 28px;
          overflow: hidden;
          z-index: 2;
        }
        .migrate-case-quote::before {
          background: radial-gradient(ellipse at center, color-mix(in srgb, var(--ambient-ink) 24%, transparent), transparent 68%);
          content: '';
          height: 90px;
          left: -40px;
          opacity: 0.8;
          pointer-events: none;
          position: absolute;
          top: -48px;
          transform: rotate(-12deg);
          width: 230px;
        }
        .migrate-case-quote > * {
          position: relative;
          z-index: 1;
        }
        .migrate-case-quote blockquote {
          color: var(--c1);
          font-family: Inter, body;
          font-size: 15px;
          font-weight: 420;
          letter-spacing: -0.012em;
          line-height: 1.4;
          margin: 0;
        }
        .migrate-case-quote-author {
          align-items: center;
          display: flex;
          gap: 10px;
        }
        .migrate-case-quote-author img {
          border-radius: 50%;
          height: 38px;
          object-fit: cover;
          width: 38px;
        }
        .migrate-case-quote-author span {
          display: grid;
          gap: 2px;
        }
        .migrate-case-quote-author strong {
          color: var(--c1);
          font-family: body, sans-serif;
          font-size: 14px;
          line-height: 1.15;
        }
        .migrate-case-quote-author small {
          color: var(--c4);
          font-family: body, sans-serif;
          font-size: 11px;
          line-height: 1.2;
        }
        .migrate-case-play {
          align-items: center;
          bottom: 28px;
          display: grid;
          gap: 14px;
          grid-template-columns: min-content min-content 1fr;
          left: 28px;
          pointer-events: none;
          position: absolute;
          right: 28px;
          z-index: 2;
        }
        .migrate-case-play span:not(.migrate-case-play-rule) {
          color: var(--c1);
          font-family: Inter, body;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.1em;
          line-height: 1;
          text-transform: uppercase;
          white-space: nowrap;
        }
        .migrate-case-play-rule {
          background-color: var(--c1);
          height: 1px;
          margin-top: 1px;
          opacity: 0.8;
          width: 100%;
        }
        @media (max-width: 699px) {
          .migrate-case-video { aspect-ratio: 4 / 3; }
          .migrate-case-heading { left: 18px; top: 18px; }
          .migrate-case-title { font-size: 24px; }
          .migrate-case-subtitle { font-size: 14px; margin-bottom: 16px; }
          .migrate-case-quote { display: none; }
          .migrate-case-quote blockquote { font-size: 13px; line-height: 1.35; }
          .migrate-case-quote-author { gap: 8px; }
          .migrate-case-quote-author img { height: 32px; width: 32px; }
          .migrate-case-quote-author strong { font-size: 13px; }
          .migrate-case-quote-author small { display: none; }
          .migrate-case-play { bottom: 18px; gap: 12px; left: 18px; right: 18px; }
          .migrate-case-play span:not(.migrate-case-play-rule) { font-size: 13px; }
        }
      `}</style>

      {/* Hero */}
      <div
        style={{
          display: 'flow-root',
          'min-width': '0',
          position: 'relative',
          width: '100%',
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
            width: '100%',
            // Above the connector scene below, which is pulled up far enough to
            // overlap this section's lower edge. The scene is itself clickable
            // (and holds the import link), so without this it wins the hit test
            // in the overlap and swallows clicks meant for the CTAs.
            'z-index': 2,
          }}
        >
          <div
            style={{
              'box-sizing': 'border-box',
              display: 'grid',
              gap: mobile() ? '24px' : '28px',
              'justify-items': mobile() ? 'start' : 'center',
              'max-width': mobile() ? '100%' : '760px',
              'text-align': mobile() ? 'left' : 'center',
              width: '100%',
            }}
          >
            <h1
              style={{
                'font-family': 'display',
                'font-size': mobile() ? 'clamp(42px, 11.5vw, 58px)' : '52.36px',
                'font-weight':
                  'calc(315 + var(--cream-slab-weight-increase, 0))',
                'letter-spacing': '-0.012em',
                'line-height': 1.12,
                margin: '0',
              }}
            >
              Switch your company to Macro
            </h1>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'Inter, body',
                'font-size': mobile() ? '15px' : '15px',
                'font-weight': '400',
                'line-height': 1.55,
                margin: '0',
                'max-width': mobile() ? '36ch' : '760px',
                'text-wrap': 'pretty',
              }}
            >
              Connect your email, bring over your files, and import work from
              your existing tools.
            </p>
          </div>
        </section>

        {/* The connector scene shows incoming tools linked to Macro.
            Click it to replay the slide. */}
        <div
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            'justify-items': 'center',
            'padding-block': mobile() ? '20px 0' : '28px 0',
            'padding-inline': mobile() ? '12px' : '24px',
            position: 'relative',
            width: '100%',
            'z-index': 1,
          }}
        >
          {/* Keep the illustration wash separate from the case-study video. */}
          <div class="migrate-washband">
            <div class="migrate-graphic-card">
              <div class="migrate-figure">
                <SetupGraphic
                  class="migrate-hero-graphic"
                  importButton={{
                    href: ctaHref(),
                    leadingLabel: 'Connect your tools',
                    trailingLabel: 'Bring work over',
                    onClick: (event) =>
                      handleCtaClick(event, 'migrate_hero_import'),
                    horizontalOffsetPx: mobile() ? 0 : -46,
                    verticalOffset: mobile() ? 180 : 0,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <MigrationPaths helpHref={DEMO_CALL_HREF} />

      <section
        aria-label="Bring work over with an agent"
        style={sectionShell()}
      >
        <div style={{ ...columnStyle(), 'justify-items': 'center' }}>
          <SectionHeading title="Tell your agent what to bring over." />
          <div class="migrate-connected-tools">
            <For each={MODULE_ROW}>
              {(logo) => (
                <ModuleGraphic
                  logo={logo}
                  state="linked"
                  class="migrate-module-graphic"
                />
              )}
            </For>
          </div>
          <p
            style={{
              ...bodyStyle(),
              'max-width': '720px',
              'text-align': 'center',
            }}
          >
            Connect an app such as Notion or Linear in Settings. Your agent can
            then find the pages and issues available to your connected account.
            Tell it which work matters to your company.
          </p>
        </div>
      </section>

      <HomeSectionRule />

      <section aria-label="Moving your company" style={sectionShell()}>
        <div style={columnStyle()}>
          <SectionHeading title="Moving your company" />
          <div class="migrate-practical-faq">
            <details class="migrate-faq__item">
              <summary>
                <span>What comes over with the import?</span>
                <CaretDown aria-hidden="true" />
              </summary>
              <p class="migrate-faq__answer">
                Notion pages become editable docs. Linear issues become tasks
                with descriptions, source links, and supported status, priority,
                assignee, and due-date fields. Files and CSVs use their own
                upload and import flows.{' '}
                <a href={DOCS_SWITCH}>See the source-specific import guide</a>.
              </p>
            </details>
            <details class="migrate-faq__item">
              <summary>
                <span>Does imported work stay in sync with the old tool?</span>
                <CaretDown aria-hidden="true" />
              </summary>
              <p class="migrate-faq__answer">
                Imports create copies in Macro. Later edits in Notion or Linear
                do not automatically replace those copies. Connected tools
                remain available to agents. Gmail works differently: your
                connected mailbox continues to sync.
              </p>
            </details>
            <details class="migrate-faq__item">
              <summary>
                <span>How do we bring the team over?</span>
                <CaretDown aria-hidden="true" />
              </summary>
              <p class="migrate-faq__answer">
                Review the imported work, confirm task assignees, and set
                sharing in Macro. Invite teammates by email and give them access
                to the projects and channels they need. Your company can move
                together or in stages.
              </p>
            </details>
            <details class="migrate-faq__item">
              <summary>
                <span>Can your team help plan a larger move?</span>
                <CaretDown aria-hidden="true" />
              </summary>
              <p class="migrate-faq__answer">
                Yes. Tell us which tools you use, how much work you want to
                bring over, and which history matters. We’ll help choose the
                import routes and plan the move.{' '}
                <a href={DEMO_CALL_HREF}>Talk to our team</a>.
              </p>
            </details>
          </div>
        </div>
      </section>

      <HomeSectionRule />

      <DesyncCaseStudy />
      <HomeSectionRule />

      {/* The overview is visible; provider-specific detail stays in the linked pages. */}
      <section
        aria-label="Macro compared to the rest of the toolset"
        style={{
          ...sectionShell(),
          'padding-block': mobile() ? '48px' : '64px',
        }}
      >
        <div class="migrate-full-comparison">
          <FeatureComparisons
            title="Compare all tools"
            comparisons={migrationComparisons}
            tableMinWidth={900}
          />
          <Show when={mobile()}>
            <p class="migrate-scroll-hint">Scroll sideways to compare →</p>
          </Show>
        </div>
      </section>

      <HomeSectionRule />

      {/* Final CTA */}
      <div
        style={{
          'padding-block': mobile() ? '80px' : '116px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <section
          aria-label="Get help from our team"
          style={{
            'align-items': mobile() ? 'start' : 'center',
            display: 'grid',
            gap: mobile() ? '30px' : '38px',
            'justify-items': mobile() ? 'start' : 'center',
            'text-align': mobile() ? 'left' : 'center',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: mobile() ? '16px' : '20px',
              'justify-items': mobile() ? 'start' : 'center',
              'max-width': '585px',
            }}
          >
            <h2
              style={{
                'font-family': 'display',
                'font-size': mobile() ? '36px' : '48px',
                'font-weight':
                  'calc(315 + var(--cream-slab-weight-increase, 0))',
                'letter-spacing': '-0.015em',
                'line-height': 1.08,
                margin: '0',
              }}
            >
              Get help from our team
            </h2>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'Inter, body',
                'font-size': mobile() ? '14px' : '16px',
                'line-height': 1.55,
                margin: '0',
              }}
            >
              Book a call with us. We’ll answer your questions and help you get
              your company set up in Macro.
            </p>
          </div>
          <div
            style={{
              'align-items': 'center',
              display: 'flex',
              'flex-direction': mobile() ? 'column' : 'row',
              gap: mobile() ? '12px' : '14px',
              width: mobile() ? '100%' : 'auto',
            }}
          >
            <BookCallButton large label="Talk to our team" />
          </div>
        </section>
      </div>

      {/* Divider + footer */}
      <div
        style={{
          'padding-bottom': mobile() ? '40px' : '48px',
          'padding-inline': mobile() ? '18px' : '24px',
        }}
      >
        <SectionMoreFeatures currentPath="/migrate" footerOnly />
      </div>
    </div>
  );
};
