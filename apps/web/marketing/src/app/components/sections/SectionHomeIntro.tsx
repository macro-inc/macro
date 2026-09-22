import { createSignal, For, type JSX } from 'solid-js';
import AccountsFig from '../../../assets/graphics/fig-accounts.svg';
import DbFig from '../../../assets/graphics/fig-db.svg';
import SpeedFig from '../../../assets/graphics/fig-speed.svg';
import { createVisible } from '../../utils/utilVisible';
import {
  InfiniteCarousel,
  type InfiniteCarouselHandle,
} from '../utils/InfiniteCarousel';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';

type Pillar = {
  slug: string;
  title: string;
  body: string;
  Graphic: (props: { height: string }) => JSX.Element;
};

function FigAccounts(props: { height: string }) {
  return (
    <AccountsFig
      class="home-intro-figure home-intro-figure--accounts"
      style={{
        display: 'block',
        height: props.height,
        overflow: 'visible',
        width: 'auto',
      }}
    />
  );
}

function FigDb(props: { height: string }) {
  return (
    <DbFig
      class="home-intro-figure home-intro-figure--db"
      style={{
        display: 'block',
        height: props.height,
        overflow: 'visible',
        width: 'auto',
      }}
    />
  );
}

function FigSpeed(props: { height: string }) {
  return (
    <SpeedFig
      class="home-intro-figure home-intro-figure--speed"
      style={{
        display: 'block',
        height: 'auto',
        'max-height': props.height,
        'max-width': '100%',
        overflow: 'visible',
        width: '100%',
      }}
    />
  );
}

const pillars: Pillar[] = [
  {
    slug: 'all-in-one',
    title: 'All in one',
    body: 'Email, messages, docs, tasks, calls, and CRM — @linked together in one workspace.',
    Graphic: FigAccounts,
  },
  {
    slug: 'shared-memory',
    title: 'Shared memory',
    body: 'Shared, team-level memory built nightly from your unified workspace.',
    Graphic: FigDb,
  },
  {
    slug: 'open-source',
    title: 'Open source',
    body: 'Contribute, fork, extend and self-host. Built for speed in Rust and SolidJS.',
    Graphic: FigSpeed,
  },
];

function IntroPillar(props: {
  active?: boolean;
  mobile: boolean;
  pillar: Pillar;
}) {
  const figureHeight = () => (props.mobile ? '210px' : '220px');
  const figureArea = () => (props.mobile ? '238px' : '220px');

  return (
    <div
      class={`home-intro-pillar home-intro-pillar--${props.pillar.slug}`}
      style={{
        // Desktop assembly durations and internal delays are 30% shorter.
        '--intro-speed': props.mobile ? '1' : '0.875',
        'align-content': 'start',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: props.mobile ? '22px' : '28px',
      }}
    >
      <div
        class="home-intro-graphic-stage"
        classList={{
          // Desktop pillars render at rest and animate on hover only.
          'is-active': props.mobile && Boolean(props.active),
        }}
        style={{
          'align-items': 'center',
          display: 'flex',
          height: figureArea(),
          'justify-content': 'center',
          width: '100%',
        }}
      >
        <props.pillar.Graphic height={figureHeight()} />
      </div>
      <div
        class="home-intro-pillar-copy"
        style={{
          display: 'grid',
          gap: props.mobile ? '16px' : '20px',
          'margin-left':
            !props.mobile && props.pillar.slug === 'all-in-one'
              ? '8px'
              : undefined,
        }}
      >
        <h3
          style={{
            color: 'var(--c2)',
            'font-family': 'body',
            'font-size': props.mobile ? '15px' : '14px',
            'font-weight': '700',
            'letter-spacing': '0.07em',
            'line-height': 1.2,
            margin: '0',
            'text-transform': 'uppercase',
            'text-wrap': 'balance',
          }}
        >
          {props.pillar.title}
        </h3>
        <p
          style={{
            color: props.mobile
              ? 'color-mix(in srgb, var(--c4) 84%, transparent)'
              : 'color-mix(in srgb, var(--c4) 64%, transparent)',
            'font-family': 'body',
            'font-size': props.mobile ? '14px' : '12.5px',
            'font-weight': '500',
            'line-height': 1.4,
            margin: '0',
            'max-width': '44ch',
            'text-wrap': 'balance',
          }}
        >
          {props.pillar.body}
        </p>
      </div>
    </div>
  );
}

function DesktopIntroPillars() {
  return (
    <div
      class="home-intro-grid"
      style={{
        color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))',
      }}
    >
      <For each={pillars}>
        {(pillar, index) => (
          <div
            class={
              index() === 0
                ? 'home-intro-grid-cell--first'
                : index() === pillars.length - 1
                  ? 'home-intro-grid-cell--last'
                  : 'home-intro-grid-cell--mid'
            }
          >
            <IntroPillar pillar={pillar} mobile={false} />
          </div>
        )}
      </For>
    </div>
  );
}

export function SectionHomeIntro() {
  const [activePillar, setActivePillar] = createSignal(0);
  let mobileCarousel: InfiniteCarouselHandle | undefined;
  let mobileCarouselEl: HTMLDivElement | undefined;
  const mobileCarouselVisible = createVisible(
    () => mobileCarouselEl,
    '0px 0px -12% 0px'
  );

  return (
    <section
      aria-label="What is Macro"
      class="home-intro-section"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        padding: '0',
        width: '100%',
      }}
    >
      {/* Founder letter: one centred column so the heading, body, and
          signature share a left edge. Pillars below keep the full width. */}
      <div class="home-intro-letter">
        <h2 data-intro-headline="macro" class="home-intro-letter-title">
          Built for companies scaling from seed to IPO.
        </h2>
        <div class="home-intro-letter-copy">
          <p class="home-intro-letter-body">
            Our first startup came apart post Series A, right when it felt like
            everything was going well. We had twenty people across engineering,
            marketing, and sales, $1M+ ARR, $20M funding. The problem was the
            company wasn't built to scale. Engineering, sales, and marketing
            weren't operating as one. Context was scattered across Slack, email,
            docs, meetings, and a dozen SaaS tools. We realized we were missing
            something fundamental: an operating cadence for the company, and a
            system to support it. Macro is that system.
          </p>
          <p class="home-intro-letter-signoff">
            - Jacob Beckerman
            <span class="home-intro-letter-signoff-sep">, </span>
            <span class="home-intro-letter-signoff-role">
              Co-Founder &amp; CEO at Macro
            </span>
          </p>
        </div>
      </div>

      <SsgDesktop>
        <DesktopIntroPillars />
      </SsgDesktop>
      <SsgMobile>
        <div
          ref={(element) => {
            mobileCarouselEl = element;
          }}
          style={{
            color: 'color-mix(in srgb, var(--a0) 60%, var(--b0))',
            display: 'grid',
            gap: '20px',
            'margin-inline': '-18px',
            overflow: 'hidden',
            width: 'calc(100% + 36px)',
          }}
        >
          <InfiniteCarousel
            ariaLabel="What makes Macro different"
            class="home-intro-mobile-carousel"
            items={pillars}
            onActiveChange={setActivePillar}
            onReady={(handle) => {
              mobileCarousel = handle;
            }}
            style={{
              display: 'flex',
              overflow: 'auto',
              'overscroll-behavior-x': 'contain',
              padding: '0',
              'scroll-behavior': 'smooth',
              'scroll-snap-type': 'x mandatory',
              width: '100%',
            }}
          >
            {(pillar, context) => (
              <article
                aria-hidden={context.isClone()}
                id={
                  context.isClone()
                    ? undefined
                    : `home-intro-pillar-${context.logicalIndex()}`
                }
                style={{
                  'box-sizing': 'border-box',
                  flex: '0 0 calc(100% - 36px)',
                  margin: '0 8px',
                  padding: '8px 22px 12px',
                  'scroll-snap-align': 'center',
                  'scroll-snap-stop': 'always',
                }}
              >
                <IntroPillar
                  active={
                    mobileCarouselVisible() &&
                    activePillar() === context.logicalIndex()
                  }
                  pillar={pillar}
                  mobile
                />
              </article>
            )}
          </InfiniteCarousel>
          <div
            aria-label="What makes Macro different"
            style={{
              display: 'flex',
              gap: '8px',
              'justify-content': 'center',
            }}
          >
            <For each={pillars}>
              {(pillar, index) => (
                <button
                  aria-controls={`home-intro-pillar-${index()}`}
                  aria-label={`Show ${pillar.title}`}
                  aria-pressed={activePillar() === index()}
                  onClick={() => mobileCarousel?.select(index())}
                  style={{
                    background:
                      activePillar() === index()
                        ? 'var(--a0)'
                        : 'color-mix(in srgb, var(--c4) 34%, transparent)',
                    border: '0',
                    'border-radius': '999px',
                    cursor: 'pointer',
                    height: '7px',
                    padding: '0',
                    transition:
                      'background-color 180ms ease, transform 180ms ease, width 180ms ease',
                    width: activePillar() === index() ? '24px' : '7px',
                  }}
                  type="button"
                />
              )}
            </For>
          </div>
        </div>
      </SsgMobile>

      <style>{`
        /* Viewport-dependent layout in CSS so the prerender is correct on
           phones before the JS bundle loads. The letter is its own beat;
           space below it is on the letter, not the section gap. */
        /* Letter and graphics share one measure: a bit wider than the old
           104ch letter, a bit narrower than the full-bleed pillar row. */
        .home-intro-section { gap: 0; --home-intro-measure: 1000px; }
        .home-intro-letter {
          margin: 0 auto 160px;
          max-width: var(--home-intro-measure);
          width: 100%;
        }
        .home-intro-letter-title {
          color: var(--c1);
          font-family: display;
          font-size: 32px;
          font-weight: 350;
          letter-spacing: -0.015em;
          line-height: 1.2;
          margin: 0 0 56px;
          text-align: left;
          text-wrap: balance;
        }
        .home-intro-letter-copy {
          display: grid;
          gap: 22px;
        }
        .home-intro-letter-body,
        .home-intro-letter-signoff {
          font-family: cyberreader;
          font-size: 18px;
          font-weight: 300;
          line-height: 1.6;
          margin: 0;
          text-align: left;
          text-wrap: pretty;
        }
        .home-intro-letter-body { color: var(--c4); }
        .home-intro-letter-signoff { color: var(--c2); }
        .home-intro-grid {
          box-sizing: border-box;
          display: grid;
          gap: 0;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          margin: 0 auto;
          max-width: var(--home-intro-measure);
          width: 100%;
        }
        .home-intro-grid-cell--first { padding: 0 28px 0 0; }
        .home-intro-grid-cell--mid { padding: 0 28px; }
        .home-intro-grid-cell--last { padding: 0 0 0 28px; }
        @media (max-width: 819px) {
          .home-intro-grid { gap: 44px; grid-template-columns: 1fr; }
          .home-intro-grid-cell--first,
          .home-intro-grid-cell--mid,
          .home-intro-grid-cell--last { padding: 0; }
        }
        @media (max-width: 699px) {
          .home-intro-letter { margin-bottom: 104px; }
          .home-intro-letter-title {
            font-size: 32px;
            margin-bottom: 40px;
          }
          .home-intro-letter-copy { gap: 18px; }
          .home-intro-letter-body,
          .home-intro-letter-signoff { font-size: 15px; }
          .home-intro-letter-signoff-sep { display: none; }
          .home-intro-letter-signoff-role { display: block; }
        }

        .home-intro-mobile-carousel {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .home-intro-mobile-carousel::-webkit-scrollbar {
          display: none;
        }

        /* Shared-memory feed cadence. Each dashed run in fig-db carries its own
           dash period, so a single shared offset would make them drift apart and
           jump on loop. Instead every run advances by exactly four of its own
           periods over a duration proportional to that period: the loop is
           seamless and all four feeds stream at the same on-screen speed.
           Offsets are positive so the dashes travel puck -> drum, i.e. the
           workspace feeding memory rather than the other way round. */
        .home-intro-pillar--shared-memory .dash-89 { --wire-flow: 23.76; --wire-time: 1.07s; }
        .home-intro-pillar--shared-memory .dash-103 { --wire-flow: 27.44; --wire-time: 1.24s; }
        .home-intro-pillar--shared-memory .dash-116 { --wire-flow: 30.96; --wire-time: 1.39s; }
        .home-intro-pillar--shared-memory .dash-122 { --wire-flow: 32.56; --wire-time: 1.47s; }
        .home-intro-pillar--shared-memory .dash-123 { --wire-flow: 32.8; --wire-time: 1.48s; }
        .home-intro-pillar--shared-memory .dash-13 { --wire-flow: 34.64; --wire-time: 1.56s; }
        .home-intro-pillar--shared-memory .dash-138 { --wire-flow: 36.8; --wire-time: 1.66s; }
        @keyframes home-intro-wire-flow {
          to { stroke-dashoffset: var(--wire-flow); }
        }

        @media (prefers-reduced-motion: no-preference) {
          .home-intro-graphic-stage .home-intro-figure g {
            transform-box: fill-box;
            transform-origin: center;
          }

          /* Seed each part's start pose on .is-active so desktop hover can
             replay from the same disassembled state mobile uses at rest.
             Keyframes only define the settle pose (animation from = these). */
          .home-intro-pillar--all-in-one .is-active #box,
          .home-intro-pillar--all-in-one .is-active #middle-card,
          .home-intro-pillar--all-in-one .is-active #back-card,
          .home-intro-pillar--all-in-one .is-active #front-card {
            opacity: 0;
          }
          .home-intro-pillar--all-in-one .is-active #box {
            transform: translateY(42px) scale(0.96);
            animation: home-intro-box-land calc(620ms * var(--intro-speed, 1)) cubic-bezier(0.22, 1, 0.36, 1) calc(var(--intro-enter-delay, 0ms) + 80ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--all-in-one .is-active #middle-card,
          .home-intro-pillar--all-in-one .is-active #back-card,
          .home-intro-pillar--all-in-one .is-active #front-card {
            transform: translateY(-54px);
          }
          .home-intro-pillar--all-in-one .is-active #back-card {
            animation: home-intro-card-drop calc(680ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 210ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--all-in-one .is-active #middle-card {
            animation: home-intro-card-drop calc(620ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 360ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--all-in-one .is-active #front-card {
            animation: home-intro-card-drop calc(680ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 500ms * var(--intro-speed, 1)) forwards;
          }

          /* Shared memory assembles inward: the drum lands first, the two
             workspace crates settle against it, then the feeds wire up and the
             pucks drop in. Wires start flowing once they're drawn. */
          .home-intro-pillar--shared-memory .is-active #drum,
          .home-intro-pillar--shared-memory .is-active #overlap-shadow-drum,
          .home-intro-pillar--shared-memory .is-active #crate-left,
          .home-intro-pillar--shared-memory .is-active #overlap-shadow-crate-left,
          .home-intro-pillar--shared-memory .is-active #crate-right,
          .home-intro-pillar--shared-memory .is-active #overlap-shadow-crate-right,
          .home-intro-pillar--shared-memory .is-active #wire-back,
          .home-intro-pillar--shared-memory .is-active #wire-left,
          .home-intro-pillar--shared-memory .is-active #wire-mid,
          .home-intro-pillar--shared-memory .is-active #wire-right,
          .home-intro-pillar--shared-memory .is-active #puck-back,
          .home-intro-pillar--shared-memory .is-active #puck-left,
          .home-intro-pillar--shared-memory .is-active #puck-mid,
          .home-intro-pillar--shared-memory .is-active #puck-right {
            opacity: 0;
          }
          .home-intro-pillar--shared-memory .is-active #drum,
          .home-intro-pillar--shared-memory .is-active #overlap-shadow-drum {
            transform: translateY(-58px) scale(0.96);
            animation: home-intro-drum-land calc(620ms * var(--intro-speed, 1)) cubic-bezier(0.22, 1, 0.36, 1) calc(var(--intro-enter-delay, 0ms) + 80ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #crate-left,
          .home-intro-pillar--shared-memory .is-active #overlap-shadow-crate-left {
            transform: translate(-54px, 30px);
            animation: home-intro-part-settle calc(660ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 250ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #crate-right,
          .home-intro-pillar--shared-memory .is-active #overlap-shadow-crate-right {
            transform: translate(56px, 32px);
            animation: home-intro-part-settle calc(660ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 340ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #puck-back {
            transform: translate(-44px, -18px);
            animation: home-intro-part-settle calc(560ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 470ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #puck-left {
            transform: translate(-40px, 38px);
            animation: home-intro-part-settle calc(560ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 560ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #puck-mid {
            transform: translateY(46px);
            animation: home-intro-part-settle calc(560ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 640ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #puck-right {
            transform: translate(46px, 38px);
            animation: home-intro-part-settle calc(560ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 720ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #wire-back {
            animation: home-intro-link-draw calc(460ms * var(--intro-speed, 1)) ease-out calc(var(--intro-enter-delay, 0ms) + 470ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #wire-left {
            animation: home-intro-link-draw calc(460ms * var(--intro-speed, 1)) ease-out calc(var(--intro-enter-delay, 0ms) + 560ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #wire-mid {
            animation: home-intro-link-draw calc(460ms * var(--intro-speed, 1)) ease-out calc(var(--intro-enter-delay, 0ms) + 640ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--shared-memory .is-active #wire-right {
            animation: home-intro-link-draw calc(460ms * var(--intro-speed, 1)) ease-out calc(var(--intro-enter-delay, 0ms) + 720ms * var(--intro-speed, 1)) forwards;
          }
          /* Feeds start streaming once the last wire has drawn in. */
          .home-intro-pillar--shared-memory .is-active [class*='dash-'] {
            animation: home-intro-wire-flow var(--wire-time) linear calc(var(--intro-enter-delay, 0ms) + 1180ms * var(--intro-speed, 1)) infinite;
          }

          .home-intro-pillar--open-source .is-active #casing,
          .home-intro-pillar--open-source .is-active #cone,
          .home-intro-pillar--open-source .is-active #tip,
          .home-intro-pillar--open-source .is-active #axis {
            opacity: 0;
          }
          .home-intro-pillar--open-source .is-active #casing {
            transform: translate(-68px, -40px);
            animation: home-intro-projectile-assemble calc(720ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 180ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--open-source .is-active #cone {
            transform: translate(-28px, -18px);
            animation: home-intro-projectile-assemble calc(720ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 330ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--open-source .is-active #tip {
            transform: translate(76px, 46px);
            animation: home-intro-projectile-assemble calc(760ms * var(--intro-speed, 1)) cubic-bezier(0.16, 1, 0.3, 1) calc(var(--intro-enter-delay, 0ms) + 470ms * var(--intro-speed, 1)) forwards;
          }
          .home-intro-pillar--open-source .is-active #axis {
            transform: translate(-20px, -12px);
            animation: home-intro-projectile-axis calc(480ms * var(--intro-speed, 1)) ease-out calc(var(--intro-enter-delay, 0ms) + 70ms * var(--intro-speed, 1)) forwards;
          }

          @keyframes home-intro-box-land {
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes home-intro-card-drop {
            72% { opacity: 1; transform: translateY(5px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          @keyframes home-intro-drum-land {
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          @keyframes home-intro-part-settle {
            76% { opacity: 1; transform: translate(4px, 2px); }
            100% { opacity: 1; transform: translate(0, 0); }
          }
          @keyframes home-intro-link-draw {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes home-intro-projectile-axis {
            to { opacity: 0.58; transform: translate(0, 0); }
          }
          @keyframes home-intro-projectile-assemble {
            74% { opacity: 1; transform: translate(5px, 3px); }
            100% { opacity: 1; transform: translate(0, 0); }
          }
        }

        /* Mobile carousel idle: hold the disassembled pose until .is-active. */
        @media (max-width: 699px) and (prefers-reduced-motion: no-preference) {
          .home-intro-pillar--all-in-one #box,
          .home-intro-pillar--all-in-one #middle-card,
          .home-intro-pillar--all-in-one #back-card,
          .home-intro-pillar--all-in-one #front-card {
            opacity: 0;
          }
          .home-intro-pillar--all-in-one #box {
            transform: translateY(42px) scale(0.96);
          }
          .home-intro-pillar--all-in-one #middle-card,
          .home-intro-pillar--all-in-one #back-card,
          .home-intro-pillar--all-in-one #front-card {
            transform: translateY(-54px);
          }

          .home-intro-pillar--shared-memory #drum,
          .home-intro-pillar--shared-memory #overlap-shadow-drum,
          .home-intro-pillar--shared-memory #crate-left,
          .home-intro-pillar--shared-memory #overlap-shadow-crate-left,
          .home-intro-pillar--shared-memory #crate-right,
          .home-intro-pillar--shared-memory #overlap-shadow-crate-right,
          .home-intro-pillar--shared-memory #wire-back,
          .home-intro-pillar--shared-memory #wire-left,
          .home-intro-pillar--shared-memory #wire-mid,
          .home-intro-pillar--shared-memory #wire-right,
          .home-intro-pillar--shared-memory #puck-back,
          .home-intro-pillar--shared-memory #puck-left,
          .home-intro-pillar--shared-memory #puck-mid,
          .home-intro-pillar--shared-memory #puck-right {
            opacity: 0;
          }
          .home-intro-pillar--shared-memory #drum,
          .home-intro-pillar--shared-memory #overlap-shadow-drum {
            transform: translateY(-58px) scale(0.96);
          }
          .home-intro-pillar--shared-memory #crate-left,
          .home-intro-pillar--shared-memory #overlap-shadow-crate-left {
            transform: translate(-54px, 30px);
          }
          .home-intro-pillar--shared-memory #crate-right,
          .home-intro-pillar--shared-memory #overlap-shadow-crate-right {
            transform: translate(56px, 32px);
          }
          .home-intro-pillar--shared-memory #puck-back {
            transform: translate(-44px, -18px);
          }
          .home-intro-pillar--shared-memory #puck-left {
            transform: translate(-40px, 38px);
          }
          .home-intro-pillar--shared-memory #puck-mid {
            transform: translateY(46px);
          }
          .home-intro-pillar--shared-memory #puck-right {
            transform: translate(46px, 38px);
          }

          .home-intro-pillar--open-source #casing,
          .home-intro-pillar--open-source #cone,
          .home-intro-pillar--open-source #tip,
          .home-intro-pillar--open-source #axis {
            opacity: 0;
          }
          .home-intro-pillar--open-source #casing {
            transform: translate(-68px, -40px);
          }
          .home-intro-pillar--open-source #cone {
            transform: translate(-28px, -18px);
          }
          .home-intro-pillar--open-source #tip {
            transform: translate(76px, 46px);
          }
          .home-intro-pillar--open-source #axis {
            transform: translate(-20px, -12px);
          }
        }

        /* Desktop mirrors the email feature figures: parts transition once
           from assembled to expanded and hold there for the full hover. */
        @media (min-width: 700px) and (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
          .home-intro-pillar--all-in-one #box,
          .home-intro-pillar--all-in-one #back-card,
          .home-intro-pillar--all-in-one #middle-card,
          .home-intro-pillar--all-in-one #front-card,
          .home-intro-pillar--shared-memory #drum,
          .home-intro-pillar--shared-memory #overlap-shadow-drum,
          .home-intro-pillar--shared-memory #crate-left,
          .home-intro-pillar--shared-memory #overlap-shadow-crate-left,
          .home-intro-pillar--shared-memory #crate-right,
          .home-intro-pillar--shared-memory #overlap-shadow-crate-right,
          .home-intro-pillar--shared-memory #puck-back,
          .home-intro-pillar--shared-memory #puck-left,
          .home-intro-pillar--shared-memory #puck-mid,
          .home-intro-pillar--shared-memory #puck-right,
          .home-intro-pillar--open-source #casing,
          .home-intro-pillar--open-source #cone,
          .home-intro-pillar--open-source #tip {
            transform-box: fill-box;
            transform-origin: center;
            transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1);
          }

          .home-intro-pillar--all-in-one .home-intro-graphic-stage:hover #box {
            transform: translateY(24px);
          }
          .home-intro-pillar--all-in-one .home-intro-graphic-stage:hover #back-card {
            transform: translateY(-64px);
          }
          .home-intro-pillar--all-in-one .home-intro-graphic-stage:hover #middle-card {
            transform: translate(-28px, -12px);
          }
          .home-intro-pillar--all-in-one .home-intro-graphic-stage:hover #front-card {
            transform: translate(34px, 12px);
          }

          /* The drum is the anchor: it lifts while the crates and feed pucks
             pull away from it, so the stack reads as the centre of the graphic. */
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #drum,
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #overlap-shadow-drum {
            transform: translateY(-26px);
          }
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #crate-left,
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #overlap-shadow-crate-left {
            transform: translate(-44px, 24px);
          }
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #crate-right,
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #overlap-shadow-crate-right {
            transform: translate(46px, 26px);
          }
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #puck-back {
            transform: translate(-34px, -14px);
          }
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #puck-left {
            transform: translate(-32px, 30px);
          }
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #puck-mid {
            transform: translateY(36px);
          }
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #puck-right {
            transform: translate(36px, 30px);
          }
          /* fig-db is a network, not a stack: pulling it apart would leave the
             feed wires hanging off their pucks. Dissolve them on the way out and
             bring them back as the parts re-seat. */
          .home-intro-pillar--shared-memory #wire-back,
          .home-intro-pillar--shared-memory #wire-left,
          .home-intro-pillar--shared-memory #wire-mid,
          .home-intro-pillar--shared-memory #wire-right {
            transition: opacity 240ms ease-out;
          }
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #wire-back,
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #wire-left,
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #wire-mid,
          .home-intro-pillar--shared-memory .home-intro-graphic-stage:hover #wire-right {
            opacity: 0;
          }

          .home-intro-pillar--open-source .home-intro-graphic-stage:hover #casing {
            transform: translate(-54px, -32px);
          }
          .home-intro-pillar--open-source .home-intro-graphic-stage:hover #cone {
            transform: translate(10px, 6px);
          }
          .home-intro-pillar--open-source .home-intro-graphic-stage:hover #tip {
            transform: translate(72px, 43px);
          }
        }
      `}</style>
    </section>
  );
}
