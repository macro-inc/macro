import {
  CtaIcon,
  ctaHref,
  ctaLabel,
  demoHref,
  handleCtaClick,
  handleDemoClick,
} from '../../utils/utilCta';
import { heroEntrance } from '../../utils/utilHeroEntrance';
import { LinkBookDemo } from '../buttons/LinkBookDemo';
import { FormMobileSignup } from '../forms/FormMobileSignup';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';
import { HomeHeroBackdrop } from './HomeAppPreview';
import { HomeDesktopFeatureCarousel } from './HomeDesktopFeatureCarousel';
import { HomeIntroProof } from './HomeIntroProof';
import { HomeMobileFeatureCarousel } from './HomeMobileFeatureCarousel';
import { HomeSectionRule } from './HomeSectionRule';
import { SectionHomeFeatures } from './SectionHomeFeatures';
import { SectionHomeIntro } from './SectionHomeIntro';

export function SectionHomeSimple() {
  return (
    <div
      class="home-simple-root"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        // Explicit constrained column: Safari grows an implicit `auto` grid
        // column to its content's max-content (the app-preview's nowrap rows),
        // blowing the hero wrapper past the viewport and shifting the page right.
        // `minmax(0, 1fr)` pins the column to the container width in every engine.
        'grid-template-columns': 'minmax(0, 1fr)',
        gap: '0',
        'min-width': '0',
        width: '100%',
      }}
    >
      <style>{`
        /* Viewport-dependent spacing lives in CSS (not JS ternaries) so the
           build-time prerender — which has no real viewport — paints correctly
           on phones before the bundle loads. */
        .home-simple-root { padding-bottom: 64px; }
        .home-simple-hero {
          row-gap: 20px;
          padding-top: 128px;
          padding-left: 64px;
          padding-right: 24px;
        }
        .home-simple-title {
          color: var(--c0);
          font-family: display;
          font-size: clamp(48px, 5.5vw, 76px);
          font-weight: 360;
          letter-spacing: -0.02em;
          line-height: 1.08;
          margin: 0;
          max-width: 100%;
          text-wrap: balance;
        }
        .home-simple-intro-pad { padding: 64px 24px 103px; }
        @media (max-width: 699px) {
          .home-simple-root { padding-bottom: 48px; }
          .home-simple-hero {
            row-gap: 24px;
            padding-top: 96px;
            padding-left: 18px;
            padding-right: 18px;
          }
          .home-simple-title {
            font-size: clamp(40px, 11vw, 60px);
            max-width: 12ch;
          }
          .home-simple-intro-pad { padding: 52px 18px 87px; }
        }
        @media (hover) {
          .home-hero-cta:hover {
            transform: scale(1.02);
          }
          .base-header-pill-cta:hover {
            transform: scale(1.02);
          }
        }
      `}</style>

      {/* Full-hero gradient: a contained, rounded glow behind BOTH the headline
          and the product preview (like Linear's hero). Two layers — a soft
          white radial bloom over a vertical wash that eases from black at
          the top to a muted light at the bottom where the divider meets
          it. Edges are feathered so the rounded panel reads as a soft glow, not a
          hard box. */}
      <div
        style={{
          'min-width': '0',
          position: 'relative',
          width: '100%',
        }}
      >
        {/* Layered hero backdrop (full-bleed wash + contained white glow +
            grain), shared with the feature heroes. */}
        <div
          aria-hidden="true"
          data-hero-entrance="backdrop"
          ref={heroEntrance('backdrop')}
          style={{ position: 'absolute', inset: '0', 'pointer-events': 'none' }}
        >
          <HomeHeroBackdrop neutral />
        </div>

        <section
          class="home-simple-hero"
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            'justify-items': 'start',
            'padding-bottom': '0',
            position: 'relative',
            'z-index': 1,
            width: '100%',
          }}
        >
          <h1
            class="home-simple-title"
            data-hero-entrance="title"
            ref={heroEntrance('title')}
          >
            The ultimate workspace.
          </h1>
          {/* The prerender ships both hero variants (CSS-gated at 700px); the
            client render mounts only the one matching the real viewport. */}
          <SsgMobile>
            {/* Mobile: supporting copy and inline signup. */}
            <div
              style={{
                'box-sizing': 'border-box',
                display: 'grid',
                gap: '24px',
                'justify-items': 'start',
                'max-width': '1080px',
                'text-align': 'left',
                width: '100%',
              }}
            >
              <h2
                style={{
                  color: 'var(--c4)',
                  'font-family': 'cyberreader',
                  'font-size': '15.5px',
                  'font-weight': '400',
                  'line-height': 1.5,
                  margin: '0',
                  'max-width': '578px',
                }}
              >
                Macro replaces 11+ apps with a single system for the whole
                company. Email, team chat, docs, tasks, calendar, CRM and agents
                — tied together with team-level memory.
              </h2>
              {/* Email capture inline in the hero. Signup itself happens on
                desktop, so the phone's job is just to hand us an address —
                asking for it here converts far better than sending the
                visitor off to load the app first. */}
              <div
                data-hero-signup
                style={{
                  'box-sizing': 'border-box',
                  display: 'grid',
                  gap: '6px',
                  'justify-items': 'center',
                  'margin-top': '4px',
                  width: '100%',
                }}
              >
                <FormMobileSignup buttonName="hero_get_started" />
                <LinkBookDemo buttonName="hero_book_demo" />
              </div>
            </div>
          </SsgMobile>
          <SsgDesktop>
            {/* Desktop: redesigned left-aligned hero. */}
            <div
              style={{
                'box-sizing': 'border-box',
                display: 'grid',
                gap: '28px',
                'justify-items': 'start',
                'max-width': '1080px',
                'text-align': 'left',
                width: '100%',
              }}
            >
              <div
                style={{
                  display: 'grid',
                  gap: '20px',
                  'justify-items': 'start',
                  'max-width': '100%',
                }}
              >
                <h2
                  data-hero-entrance="copy"
                  ref={heroEntrance('copy')}
                  style={{
                    color: 'var(--c4)',
                    'font-family': 'cyberreader',
                    'font-size': '18px',
                    'font-weight': '300',
                    'line-height': 1.6,
                    margin: '0',
                    'max-width': '750px',
                    'text-align': 'left',
                    'text-wrap': 'pretty',
                  }}
                >
                  Macro replaces 11+ apps with a single system for the whole
                  company. Email, team chat, docs, tasks, calendar, CRM and
                  agents — tied together with team-level memory.
                </h2>
              </div>
              <div
                style={{
                  'align-items': 'flex-start',
                  display: 'flex',
                  'flex-direction': 'column',
                  'margin-left': '-8px',
                }}
              >
                <div
                  class="home-hero-cta-bar"
                  data-hero-entrance="actions"
                  ref={heroEntrance('actions')}
                  style={{
                    'align-items': 'center',
                    'backdrop-filter': 'blur(6px)',
                    '-webkit-backdrop-filter': 'blur(6px)',
                    'background-color':
                      'color-mix(in srgb, var(--b1) 86%, transparent)',
                    border:
                      '1px solid color-mix(in srgb, var(--b4) 32%, transparent)',
                    'border-radius': '999px',
                    'box-shadow':
                      'inset 0 1px 0 color-mix(in srgb, var(--c1) 6%, transparent), inset 0 -1px 0 color-mix(in srgb, var(--b0) 40%, transparent), 0 14px 32px -22px rgb(0 0 0 / 0.55)',
                    'box-sizing': 'border-box',
                    display: 'inline-flex',
                    gap: '10px',
                    'justify-content': 'flex-start',
                    'margin-top': '8px',
                    overflow: 'hidden',
                    padding: '10px',
                    position: 'relative',
                    width: 'fit-content',
                  }}
                >
                  <a
                    href={ctaHref()}
                    class="home-hero-cta"
                    onClick={(event) =>
                      handleCtaClick(event, 'hero_sign_up_google')
                    }
                    style={{
                      'align-items': 'center',
                      'background-color': 'var(--a0)',
                      border:
                        '1px solid color-mix(in srgb, var(--b4) 32%, transparent)',
                      'border-radius': '999px',
                      'box-sizing': 'border-box',
                      color: 'var(--b0)',
                      cursor: 'default',
                      display: 'inline-flex',
                      'font-family': 'body',
                      'font-size': '20px',
                      'font-weight': '700',
                      gap: '8px',
                      height: '40px',
                      'justify-content': 'center',
                      'letter-spacing': '0.01em',
                      'line-height': 1,
                      overflow: 'hidden',
                      padding: '0 22px',
                      'text-decoration': 'none',
                      'text-transform': 'uppercase',
                      transition: 'transform 160ms ease',
                      'white-space': 'nowrap',
                    }}
                  >
                    <CtaIcon size={16} />
                    {ctaLabel('Sign up with Google')}
                  </a>
                  <a
                    href={demoHref()}
                    class="home-hero-cta"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleDemoClick('hero_book_demo')}
                    style={{
                      'align-items': 'center',
                      'background-color': 'var(--c1)',
                      border:
                        '1px solid color-mix(in srgb, var(--b4) 32%, transparent)',
                      'border-radius': '999px',
                      'box-sizing': 'border-box',
                      color: 'var(--b0)',
                      cursor: 'default',
                      display: 'inline-flex',
                      'font-family': 'body',
                      'font-size': '20px',
                      'font-weight': '700',
                      height: '40px',
                      'justify-content': 'center',
                      'letter-spacing': '0.01em',
                      'line-height': 1,
                      padding: '0 22px',
                      'text-decoration': 'none',
                      'text-transform': 'uppercase',
                      transition: 'transform 160ms ease',
                      'white-space': 'nowrap',
                    }}
                  >
                    Book demo
                  </a>
                </div>
              </div>
            </div>
          </SsgDesktop>
        </section>

        <SsgMobile>
          <HomeMobileFeatureCarousel />
        </SsgMobile>
        <SsgDesktop>
          <HomeDesktopFeatureCarousel />
        </SsgDesktop>
      </div>

      <div style={{ position: 'relative', 'z-index': 1 }}>
        <HomeIntroProof />
      </div>

      <div style={{ position: 'relative', 'z-index': 1 }}>
        {/* Top rule on the intro section so the mock's overflow/transform
            can't clip or cover it. z-index keeps the rule above the hero's
            composited ink. */}
        <HomeSectionRule />
        <div class="home-simple-intro-pad">
          <SectionHomeIntro />
        </div>
      </div>

      <HomeSectionRule />

      <SectionHomeFeatures />
    </div>
  );
}
