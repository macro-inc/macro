import { A } from '@solidjs/router';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';

function CarouselChevron(props: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path
        d={props.direction === 'left' ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'}
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}

export type LoopsFeatureBlock = {
  label: string;
  headline: string | JSX.Element;
  description: JSX.Element;
  fig?: string;
  hrefLabel?: string;
  tabs?: string[];
  /** One graphic per tab — switching tabs swaps the preview. */
  graphics?: Component[];
  /** Full product shot (page hero window) shown large at natural height. */
  heroShot?: Component;
  /** Render the heroShot without the bordered card chrome (it frames itself). */
  heroBare?: boolean;
  /** Compact-screen top padding for the full-bleed hero band. */
  mobileGraphicTopPadding?: string;
  /** Desktop top padding for the full-bleed hero band. Defaults to 72px. */
  graphicTopPadding?: string;
  /** Place the mobile product link below the hero graphic rather than in the copy block. */
  mobileExploreBelowGraphic?: boolean;
  /** Place the Rajdhani description (and the product link) below the hero graphic on phones. */
  mobileCopyBelowGraphic?: boolean;
  /** Suppress the wide mobile spotlight when the graphic supplies its own backdrop. */
  mobileHideSpotlightBackdrop?: boolean;
  /** Suppress the spotlight backdrop at every viewport size. */
  hideSpotlightBackdrop?: boolean;
  /** Let a mobile hero's own framed graphic show beyond the spotlight band. */
  mobileSpotlightOverflow?: 'visible';
  /** Use a bottom-origin linear spotlight rather than the default radial glow on phones. */
  mobileSpotlightGradient?: 'bottom-linear';
  headlineSingleLine?: boolean;
  /** Custom desktop max-width for the supporting paragraph. */
  desktopDescriptionMaxWidth?: string;
  /** Put the "Explore X →" link inline at the end of the description rather than on its own line below. */
  inlineExploreLink?: boolean;
  /** Shorter headline below the mobile cutoff. */
  mobileHeadline?: string | JSX.Element;
  /** Let the split-layout headline lay out at its natural width without soft-
      wrapping (use an explicit <br/> for breaks); it may extend past its
      column rather than wrap a long line. */
  headlineNoWrap?: boolean;
  href?: string;
  footer?: JSX.Element;
};

export function LoopsFeatureSection(props: {
  block: LoopsFeatureBlock;
  /** Linear-style headline left, description right. Defaults to centered stack. */
  textLayout?: 'centered' | 'split' | 'stacked-hero';
  /** Break the graphic out to a full-bleed band with a radial spotlight glow. */
  spotlight?: boolean;
  spotlightMaxWidth?: string;
  /** Optional compact-screen override for the spotlight's space above its graphic. */
  mobileGraphicTopPadding?: string;
  /** Use a bottom-origin linear spotlight rather than the default radial glow on phones. */
  mobileSpotlightGradient?: 'bottom-linear';
  /** Strength of the spotlight center glow, as the var(--c1) mix percentage. Defaults to 17. */
  spotlightGlow?: number;
  /** On mobile, use spare viewport height as space before the graphic. */
  mobileFillGraphicGap?: boolean;
  /** Minimum mobile height used when the graphic gap is viewport-aware. */
  mobileFillGraphicGapHeight?: string;
}) {
  const [activeTab, setActiveTab] = createSignal(0);

  // Carousel behaviour for the tabbed (non-hero) graphic stage: slides advance
  // on a timer, pause on hover, and can be driven by the arrows or the tabs.
  const [paused, setPaused] = createSignal(false);
  const slideCount = () => props.block.graphics?.length ?? 0;
  const goToSlide = (index: number) => {
    const count = slideCount();
    if (count === 0) return;
    setActiveTab(((index % count) + count) % count);
  };
  const nextSlide = () => goToSlide(activeTab() + 1);
  const prevSlide = () => goToSlide(activeTab() - 1);

  onMount(() => {
    if (slideCount() < 2) return;
    const timer = setInterval(() => {
      if (!paused()) nextSlide();
    }, 5000);
    onCleanup(() => clearInterval(timer));
  });

  const splitHeadlineSize = 'clamp(32px, 4vw, 44px)';
  const splitHeadlineLh = 1.1;
  const splitDescLh = 1.45;
  const splitDescSize = 'clamp(16px, 1.7vw, 19px)';

  // When the block carries a mobile headline both variants ship in the HTML
  // and CSS picks one per viewport, so the prerender reads correctly on
  // phones before the bundle loads.
  const headline = () => (
    <Show
      when={props.block.mobileHeadline != null}
      fallback={<>{props.block.headline}</>}
    >
      <span class="loops-headline-mobile">{props.block.mobileHeadline}</span>
      <span class="loops-headline-desktop">{props.block.headline}</span>
    </Show>
  );

  const inlineEyebrow = () => {
    const href = props.block.href;
    if (!href) return null;

    const isExternal = /^https?:\/\//.test(href);
    const style: JSX.CSSProperties = {
      color: 'var(--a0)',
      'font-family': 'inherit',
      'font-size': 'inherit',
      'font-weight': 'inherit',
      'line-height': 'inherit',
      'text-decoration': 'none',
      'white-space': 'nowrap',
    };

    if (isExternal) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          class="loops-inline-explore"
          style={style}
        >
          Explore {props.block.label} →
        </a>
      );
    }

    return (
      <A href={href} class="loops-inline-explore" style={style}>
        Explore {props.block.label} →
      </A>
    );
  };

  const featureEyebrow = (align: 'left' | 'center') => {
    const href = props.block.href;
    if (!href) return null;

    const style = {
      color: 'var(--a0)',
      'font-family': 'body',
      'font-weight': '700',
      'letter-spacing': '0.08em',
      'line-height': 1,
      'text-align': align,
      'text-decoration': 'none',
      'text-transform': 'uppercase',
    } satisfies JSX.CSSProperties;

    const isExternal = /^https?:\/\//.test(href);
    if (isExternal) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          class="loops-feature-eyebrow"
          style={style}
        >
          Explore {props.block.label} →
        </a>
      );
    }

    return (
      <A href={href} class="loops-feature-eyebrow" style={style}>
        Explore {props.block.label} →
      </A>
    );
  };

  // Stacked copy: the centered layout's only treatment, and the split
  // layout's mobile variant.
  const stackedCopy = () => (
    <div
      class="loops-copy-stacked"
      style={{
        display: 'grid',
        'justify-items': 'start',
        width: '100%',
      }}
    >
      <h2
        class="loops-stacked-h2"
        classList={{
          'loops-stacked-h2--single': Boolean(props.block.headlineSingleLine),
        }}
        style={{
          color: 'var(--c0)',
          'font-family': 'display',
          'font-weight': '360',
          'letter-spacing': '-0.018em',
          'line-height': 1.1,
          margin: '0',
          'text-align': 'left',
        }}
      >
        {headline()}
      </h2>
      <Show when={!props.block.mobileCopyBelowGraphic}>
        <p
          class="loops-stacked-p"
          style={{
            color: 'var(--c4)',
            'font-family': 'cyberreader, body',
            'font-size':
              props.textLayout === 'stacked-hero' ? '15.5px' : undefined,
            'font-weight': '300',
            'line-height': props.textLayout === 'stacked-hero' ? 1.5 : 1.55,
            margin: '0',
            'max-width':
              props.textLayout === 'stacked-hero' ? '578px' : '620px',
            'text-align': 'left',
          }}
        >
          {props.block.description}
        </p>
        {/* When the product link moves below the graphic on phones, the copy
            block keeps a desktop-only copy of it. */}
        <Show
          when={props.block.mobileExploreBelowGraphic}
          fallback={featureEyebrow('left')}
        >
          <SsgDesktop>{featureEyebrow('left')}</SsgDesktop>
        </Show>
      </Show>
    </div>
  );

  return (
    <section
      aria-label={props.block.label}
      class="loops-section"
      classList={{
        'loops-section--split': props.textLayout === 'split',
        'loops-section--fillgap': Boolean(props.mobileFillGraphicGap),
      }}
      style={{
        'box-sizing': 'border-box',
        '--loops-fillgap-min-h': props.mobileFillGraphicGapHeight,
        width: '100%',
      }}
    >
      {/* Copy block. The split layout ships both the two-column (desktop) and
          stacked (mobile) treatments through the SSG gates; the centered
          layout is always stacked, so it renders the stacked copy ungated. */}
      <Show when={props.textLayout === 'split'}>
        <SsgDesktop>
          <div
            style={{
              'align-items': 'start',
              display: 'grid',
              gap: '18px 48px',
              'grid-template-columns': 'minmax(0, 1fr) minmax(0, 1fr)',
              width: '100%',
            }}
          >
            <h2
              style={{
                color: 'var(--c0)',
                'font-family': 'display',
                'font-size': splitHeadlineSize,
                'font-weight': '360',
                'grid-column': '1',
                'grid-row': '1',
                'letter-spacing': '-0.018em',
                'line-height': splitHeadlineLh,
                margin: '0',
                'max-width': props.block.headlineNoWrap
                  ? 'none'
                  : 'calc(100% - 80px)',
                'text-align': 'left',
                'white-space': props.block.headlineNoWrap
                  ? 'nowrap'
                  : undefined,
              }}
            >
              {headline()}
            </h2>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'cyberreader, body',
                'font-size': splitDescSize,
                'font-weight': '300',
                'grid-column': '2',
                'grid-row': '1',
                'line-height': splitDescLh,
                margin: '0',
                'max-width': '420px',
                'padding-left': '65px',
                'text-align': 'left',
              }}
            >
              {props.block.description}
            </p>
            <div
              style={{
                'grid-column': '2',
                'grid-row': '2',
                'padding-left': '65px',
              }}
            >
              {featureEyebrow('left')}
            </div>
          </div>
        </SsgDesktop>
      </Show>
      <Show when={props.textLayout === 'stacked-hero'}>
        <SsgDesktop>
          <div
            style={{
              display: 'grid',
              gap: '20px',
              'justify-items': 'start',
              'max-width': '100%',
              width: '100%',
            }}
          >
            <h2
              style={{
                color: 'var(--c0)',
                'font-family': 'display',
                'font-size': '37.38px',
                'font-weight': '360',
                'letter-spacing': '-0.006em',
                'line-height': 1.25,
                margin: '0',
                'text-align': 'left',
                'white-space': props.block.headlineSingleLine
                  ? 'nowrap'
                  : undefined,
              }}
            >
              {headline()}
            </h2>
            <p
              style={{
                color: 'var(--c4)',
                'font-family': 'cyberreader',
                'font-size': '18px',
                'font-weight': '400',
                'line-height': 1.6,
                margin: '0',
                'max-width':
                  props.block.desktopDescriptionMaxWidth ??
                  (props.textLayout === 'stacked-hero' ? '580px' : '750px'),
                'text-align': 'left',
                'text-wrap': 'pretty',
              }}
            >
              {props.block.description}
              <Show when={props.block.inlineExploreLink}>
                {' '}
                {inlineEyebrow()}
              </Show>
            </p>
            <Show when={!props.block.inlineExploreLink}>
              {featureEyebrow('left')}
            </Show>
          </div>
        </SsgDesktop>
      </Show>
      <Show
        when={
          props.textLayout === 'split' || props.textLayout === 'stacked-hero'
        }
        fallback={stackedCopy()}
      >
        <SsgMobile>{stackedCopy()}</SsgMobile>
      </Show>

      <div
        class="loops-band"
        classList={{
          'loops-band--spotlight': Boolean(props.spotlight),
          'loops-band--overflow-visible':
            props.block.mobileSpotlightOverflow === 'visible',
        }}
        style={{
          'box-sizing': 'border-box',
          display: 'grid',
          'justify-items': 'center',
          '--loops-mobile-top-pad': props.block.mobileGraphicTopPadding,
          '--loops-spot-top-pad': props.block.graphicTopPadding,
          'margin-inline': props.spotlight ? '0' : '0',
          position: 'relative',
          width: props.spotlight ? '100%' : '100%',
        }}
      >
        <Show when={props.spotlight && !props.block.hideSpotlightBackdrop}>
          <div
            aria-hidden="true"
            class="loops-spot-backdrop"
            classList={{
              'loops-spot-backdrop--bottom-linear':
                (props.block.mobileSpotlightGradient ??
                  props.mobileSpotlightGradient) === 'bottom-linear',
              'loops-spot-backdrop--mobile-hidden': Boolean(
                props.block.mobileHideSpotlightBackdrop
              ),
            }}
            style={{
              '--loops-glow': `${props.spotlightGlow ?? 17}%`,
              // The band clips its glow with overflow:hidden; without this the
              // radial hasn't resolved to var(--b0) yet at the top/bottom edges,
              // so the hard cut leaves a faint seam line against the page. Fade
              // the glow out before each edge so it blends seamlessly instead.
              'mask-image':
                'linear-gradient(to bottom, transparent 0, #000 72px, #000 calc(100% - 56px), transparent 100%)',
              '-webkit-mask-image':
                'linear-gradient(to bottom, transparent 0, #000 72px, #000 calc(100% - 56px), transparent 100%)',
              inset: '0',
              'pointer-events': 'none',
              position: 'absolute',
              'z-index': 0,
            }}
          />
        </Show>
        <div
          class="loops-track"
          classList={{
            'loops-track--explore-gap': Boolean(
              props.block.mobileExploreBelowGraphic ||
                props.block.mobileCopyBelowGraphic
            ),
          }}
          style={{
            'box-sizing': 'border-box',
            display: 'grid',
            // Cap the track at the available width so a fixed-width mock (e.g. a
            // scale-to-fit window) can't size this track to its own design
            // width and overflow the viewport on mobile.
            'grid-template-columns': 'minmax(0, 1fr)',
            'max-width': props.spotlight
              ? (props.spotlightMaxWidth ?? '1080px')
              : '100%',
            position: 'relative',
            'text-align': 'start',
            width: '100%',
            'z-index': 1,
            ...(props.block.heroBare ? {} : { overflow: 'hidden' }),
          }}
        >
          <Show
            when={props.block.heroShot}
            fallback={
              <div
                class="loops-stage"
                onPointerEnter={() => setPaused(true)}
                onPointerLeave={() => setPaused(false)}
                onFocusIn={() => setPaused(true)}
                onFocusOut={() => setPaused(false)}
                style={{
                  'align-items': 'center',
                  'background-color':
                    'color-mix(in srgb, var(--b1) 42%, var(--b0))',
                  border:
                    '1px solid color-mix(in srgb, var(--b4) 22%, transparent)',
                  'box-sizing': 'border-box',
                  display: 'flex',
                  'flex-shrink': '0',
                  'justify-content': 'center',
                  overflow: 'hidden',
                  position: 'relative',
                  'text-align': 'start',
                  width: '100%',
                }}
              >
                {/* Sliding track — one full-width slide per graphic */}
                <div
                  style={{
                    display: 'flex',
                    height: '100%',
                    transform: `translateX(-${activeTab() * 100}%)`,
                    transition:
                      'transform 520ms cubic-bezier(0.22, 1, 0.36, 1)',
                    width: '100%',
                  }}
                >
                  <For each={props.block.graphics}>
                    {(Graphic) => (
                      <div
                        style={{
                          'align-items': 'center',
                          display: 'flex',
                          flex: '0 0 100%',
                          height: '100%',
                          'justify-content': 'center',
                          'min-width': 0,
                          width: '100%',
                        }}
                      >
                        <Dynamic component={Graphic} />
                      </div>
                    )}
                  </For>
                </div>

                {/* Prev / next arrows */}
                <Show when={slideCount() > 1}>
                  <button
                    type="button"
                    aria-label={`Previous ${props.block.label} slide`}
                    class="loops-carousel-arrow loops-carousel-arrow--left"
                    onClick={prevSlide}
                  >
                    <CarouselChevron direction="left" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Next ${props.block.label} slide`}
                    class="loops-carousel-arrow loops-carousel-arrow--right"
                    onClick={nextSlide}
                  >
                    <CarouselChevron direction="right" />
                  </button>
                </Show>
              </div>
            }
          >
            {(HeroShot) => (
              <div
                class="loops-hero-wrap"
                classList={{
                  // Keep the visual hierarchy with the section's static copy:
                  // product shots sit just behind the headline and description.
                  'loops-hero-wrap--mask': props.block.label !== 'Tasks',
                  'loops-hero-wrap--framed': !props.block.heroBare,
                }}
                style={{
                  width: '100%',
                }}
              >
                <Dynamic component={HeroShot()} />
              </div>
            )}
          </Show>
          <Show when={props.block.mobileCopyBelowGraphic}>
            <SsgMobile>
              <div
                class="loops-mobile-below"
                style={{
                  display: 'grid',
                  'justify-items': 'start',
                  'justify-self': 'stretch',
                  width: '100%',
                }}
              >
                <p
                  class="loops-stacked-p"
                  style={{
                    color: 'var(--c4)',
                    'font-family': 'cyberreader, body',
                    'font-size':
                      props.textLayout === 'stacked-hero'
                        ? '15.5px'
                        : undefined,
                    'font-weight': '300',
                    'line-height':
                      props.textLayout === 'stacked-hero' ? 1.5 : 1.55,
                    margin: '0',
                    'max-width':
                      props.textLayout === 'stacked-hero' ? '578px' : '620px',
                    'text-align': 'left',
                  }}
                >
                  {props.block.description}
                </p>
                {featureEyebrow('left')}
              </div>
            </SsgMobile>
          </Show>
          <Show
            when={
              props.block.mobileExploreBelowGraphic &&
              !props.block.mobileCopyBelowGraphic
            }
          >
            <SsgMobile>
              <div
                style={{ 'justify-self': 'stretch', 'padding-inline': '12px' }}
              >
                {featureEyebrow('left')}
              </div>
            </SsgMobile>
          </Show>
        </div>
      </div>

      <Show when={!props.block.heroShot && props.block.tabs?.length}>
        <div
          role="tablist"
          aria-label={`${props.block.label} highlights`}
          class="loops-tabs"
          style={{
            display: 'flex',
            'flex-wrap': 'wrap',
            'justify-content': 'center',
            'text-align': 'center',
          }}
        >
          <For each={props.block.tabs}>
            {(tab, index) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab() === index()}
                class="loops-feature-tab"
                onClick={() => setActiveTab(index())}
                style={{
                  'background-color':
                    activeTab() === index()
                      ? 'color-mix(in srgb, var(--b2) 88%, var(--b0))'
                      : 'transparent',
                  border:
                    activeTab() === index()
                      ? '1px solid color-mix(in srgb, var(--b4) 24%, transparent)'
                      : '1px solid transparent',
                  'border-radius': '999px',
                  color: activeTab() === index() ? 'var(--c1)' : 'var(--c4)',
                  cursor: 'default',
                  'font-family': 'body',
                  'font-weight': '700',
                  'letter-spacing': '0.01em',
                  'line-height': 1,
                  transition:
                    'background-color 160ms ease, color 160ms ease, border-color 160ms ease',
                }}
              >
                {tab}
              </button>
            )}
          </For>
        </div>
      </Show>

      {props.block.footer}
    </section>
  );
}

export function loopsFeatureHoverStyles(): string {
  return `
    @media (max-width: 1023px) {
      .home-messages-headline-deep {
        display: none;
      }
    }
    @media (hover) {
      .loops-feature-tab:hover {
        color: var(--c2);
      }
      .loops-feature-eyebrow:hover,
      .loops-inline-explore:hover {
        color: color-mix(in srgb, var(--a0) 82%, var(--c1));
      }
      .loops-carousel-arrow:hover {
        background-color: color-mix(in srgb, var(--b2) 92%, var(--b0));
        border-color: color-mix(in srgb, var(--b4) 48%, transparent);
        color: var(--c1);
      }
    }

    /* Viewport-dependent layout for LoopsFeatureSection lives in CSS (not JS
       ternaries) so the build-time prerender paints correctly on phones
       before the bundle loads. The 700px cutoff mirrors MOBILE_CUTOFF in
       utilBreakpoint. */
    .loops-section {
      align-items: start;
      display: grid;
      gap: 32px;
      justify-items: start;
    }
    .loops-section--split {
      align-items: stretch;
      justify-items: stretch;
    }
    .loops-copy-stacked { gap: 16px; }
    .loops-stacked-h2 {
      font-size: 42px;
      max-width: 620px;
    }
    .loops-stacked-h2--single {
      max-width: 100%;
      white-space: nowrap;
    }
    .loops-stacked-p { font-size: 19px; }
    .loops-feature-eyebrow { font-size: 13px; }
    .loops-headline-mobile { display: none; }
    /* Fixed preview stage; the tallest home/feature mock is ~479px content
       plus stage padding. */
    .loops-stage {
      border-radius: 20px;
      height: 520px;
      padding: 20px 16px;
    }
    .loops-band { overflow: hidden; }
    .loops-band--spotlight { padding: var(--loops-spot-top-pad, 72px) 24px 42px; }
    .loops-spot-backdrop {
      background: radial-gradient(1180px 560px at 50% 44%, color-mix(in srgb, var(--b1) 60%, var(--ambient-ink) var(--loops-glow, 17%)) 0%, color-mix(in srgb, var(--b1) 78%, var(--b0)) 44%, var(--b0) 72%);
    }
    .loops-hero-wrap { opacity: 0.8; }
    .loops-hero-wrap--framed { padding: 16px; }
    .loops-carousel-arrow {
      align-items: center;
      background-color: color-mix(in srgb, var(--b1) 80%, var(--b0));
      border: 1px solid color-mix(in srgb, var(--b4) 30%, transparent);
      border-radius: 999px;
      color: var(--c2);
      cursor: default;
      display: inline-flex;
      height: 38px;
      justify-content: center;
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      transition: background-color 160ms ease, color 160ms ease, border-color 160ms ease;
      width: 38px;
      z-index: 2;
    }
    .loops-carousel-arrow--left { left: 12px; }
    .loops-carousel-arrow--right { right: 12px; }
    .loops-tabs { gap: 10px; }
    .loops-feature-tab {
      font-size: 14px;
      padding: 10px 16px;
    }
    @media (max-width: 699px) {
      .loops-section { gap: 28px; }
      .loops-section--split {
        align-items: start;
        justify-items: start;
      }
      .loops-section--fillgap {
        display: flex;
        flex-direction: column;
        min-height: var(--loops-fillgap-min-h, calc(100svh - 56px));
      }
      .loops-section--fillgap .loops-band {
        align-items: end;
        margin-top: auto;
      }
      .loops-copy-stacked { gap: 14px; }
      /* Spotlight graphics full-bleed past --page-gutter, then pad 18px. The
         stacked headline still sits in the guttered column, so pull it out to
         the same 18px inset as the graphic and the copy under it. */
      .loops-section--split:has(.loops-band--spotlight) .loops-copy-stacked {
        margin-inline: calc(-1 * var(--page-gutter));
        width: calc(100% + 2 * var(--page-gutter));
      }
      .loops-stacked-h2 {
        font-size: 32px;
        /* Prevent short final words in the compact feature headlines without
           relying on a breakpoint-specific manual line break. */
        text-wrap: balance;
      }
      /* The single-line treatment is desktop-only; on phones it must wrap,
         or the nowrap headline forces the shared page column wider than the
         viewport and clips every centered section. */
      .loops-stacked-h2--single {
        max-width: 620px;
        white-space: normal;
      }
      .loops-stacked-p { font-size: 17px; }
      .loops-feature-eyebrow { font-size: 11px; }
      .loops-headline-desktop { display: none; }
      .loops-headline-mobile { display: inline; }
      .loops-stage {
        border-radius: 16px;
        height: 280px;
        padding: 12px 8px;
      }
      .loops-band--spotlight {
        padding: var(--loops-mobile-top-pad, 40px) 18px 23px;
      }
      .loops-section--fillgap .loops-band--spotlight { padding-bottom: 42px; }
      .loops-band--overflow-visible { overflow: visible; }
      .loops-spot-backdrop {
        background: radial-gradient(460px 400px at 50% 44%, color-mix(in srgb, var(--b1) 60%, var(--ambient-ink) var(--loops-glow, 17%)) 0%, color-mix(in srgb, var(--b1) 78%, var(--b0)) 46%, var(--b0) 74%);
      }
      .loops-spot-backdrop--bottom-linear {
        background: linear-gradient(to top, color-mix(in srgb, var(--b1) 58%, var(--c1) var(--loops-glow, 17%)) 0%, color-mix(in srgb, var(--b1) 78%, var(--b0)) 54%, var(--b0) 88%);
      }
      .loops-spot-backdrop--mobile-hidden { display: none; }
      .loops-track--explore-gap { gap: 18px; }
      .loops-mobile-below { gap: 14px; }
      .loops-hero-wrap { opacity: 1; }
      .loops-hero-wrap--mask {
        -webkit-mask-image: radial-gradient(ellipse at 18% 18%, rgb(0 0 0 / 0.9) 0%, rgb(0 0 0 / 0.2) 100%);
        mask-image: radial-gradient(ellipse at 18% 18%, rgb(0 0 0 / 0.9) 0%, rgb(0 0 0 / 0.2) 100%);
      }
      .loops-hero-wrap--framed { padding: 12px; }
      .loops-carousel-arrow {
        height: 32px;
        width: 32px;
      }
      .loops-carousel-arrow--left { left: 8px; }
      .loops-carousel-arrow--right { right: 8px; }
      .loops-tabs { gap: 8px; }
      .loops-feature-tab {
        font-size: 13px;
        padding: 9px 14px;
      }
    }
  `;
}
