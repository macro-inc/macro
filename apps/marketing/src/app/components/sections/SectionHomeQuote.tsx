import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic, isServer } from 'solid-js/web';
import IconTwitter from '../../../assets/icons/icon-twitter.svg';
import LogoA16z from '../../../assets/logos/a16z.svg';
import markDesyncPlaceholder from '../../../assets/mark-desync-placeholder.jpg';
import markAvatar from '../../../assets/people/mark.jpeg';
import panatAvatar from '../../../assets/people/panat.webp';
import { APP_BASE_URL } from '../../utils/utilBaseUrl';
import {
  InfiniteCarousel,
  type InfiniteCarouselHandle,
} from '../utils/InfiniteCarousel';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';

const isLocalhost =
  !isServer && ['localhost', '127.0.0.1'].includes(window.location.hostname);
const desyncVideoUrl = isLocalhost
  ? '/video/desync.mp4'
  : new URL('/video/desync.mp4', APP_BASE_URL).toString();

type QuoteCard = {
  quote: string;
  name: string;
  role: string;
  background: string;
  Logo?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  hatch?: boolean;
};

type MigrateQuoteCard = Omit<QuoteCard, 'background' | 'hatch'> & {
  avatar?: string;
  handle?: string;
  href?: string;
  mention?: {
    before: string;
    label: string;
    href: string;
    after: string;
  };
};

const cards: QuoteCard[] = [
  {
    quote:
      'Macro is the biggest change to how companies work in years. By open sourcing and bringing everything into one workspace, agents and teams can move much faster.',
    name: 'Alex Rampell',
    role: 'General Partner, Andreessen Horowitz',
    background: '#E8E8E8',
    Logo: LogoA16z,
    hatch: true,
  },
  {
    quote:
      'Macro did not help us get organized. Macro is why we are organized.',
    name: 'Mark Evgenev',
    role: 'Founder/CEO, Desync',
    background: 'var(--a0)',
  },
];

const tweetCardChrome = {
  background: 'color-mix(in oklch, var(--b2), var(--b0))',
  'border-radius': '12px',
  'box-shadow':
    'inset 0 0 0 1px rgba(255, 255, 255, 0.03), inset 0 1px 0 0 rgba(255, 255, 255, 0.04), 0 0 0 1px rgba(0, 0, 0, 0.6), 0 4px 4px 0 rgba(0, 0, 0, 0.1)',
} as const;
const tweetQuote = {
  beforeMention: 'Every startup should be using ',
  mention: '@macrodotcom',
  mentionHref: 'https://x.com/macrodotcom',
  afterMention:
    ' man like for $40 you can get Notion, Slack, Linear, Zoom and the fastest UI i have ever seen for navigating Gmail like a StarCraft grandmaster',
  name: 'Panat',
  handle: '@ptaranat',
  href: 'https://x.com/ptaranat',
  avatar: panatAvatar,
};

const migrateCards: MigrateQuoteCard[] = [
  cards[0],
  {
    quote: '',
    name: tweetQuote.name,
    role: tweetQuote.handle,
    avatar: tweetQuote.avatar,
    href: tweetQuote.href,
    mention: {
      before: tweetQuote.beforeMention,
      label: tweetQuote.mention,
      href: tweetQuote.mentionHref,
      after: tweetQuote.afterMention,
    },
  },
  { ...cards[1], avatar: markAvatar },
];

type HomeQuoteSlide = { kind: 'quote'; card: QuoteCard } | { kind: 'tweet' };

const homeQuoteSlides: HomeQuoteSlide[] = [
  { kind: 'quote', card: cards[0] },
  { kind: 'quote', card: cards[1] },
  { kind: 'tweet' },
];

function QuoteFigure(props: { card: QuoteCard }) {
  return (
    <figure
      class="home-quote-card"
      style={{
        background: props.card.background,
        'border-radius': '12px',
        'box-sizing': 'border-box',
        color: 'var(--b0)',
        display: 'grid',
        'grid-template-rows': '1fr auto',
        height: '100%',
        margin: '0',
        overflow: 'hidden',
        position: 'relative',
        width: '100%',
      }}
    >
      <Show when={props.card.hatch}>
        <div
          aria-hidden="true"
          style={{
            'background-image':
              'repeating-linear-gradient(315deg, color-mix(in srgb, var(--b0) 2.5%, transparent) 0, color-mix(in srgb, var(--b0) 2.5%, transparent) 1px, transparent 0, transparent 50%)',
            'background-size': '10px 10px',
            inset: '0',
            'pointer-events': 'none',
            position: 'absolute',
            'z-index': 0,
          }}
        />
      </Show>
      <blockquote
        class="home-quote-card-quote"
        style={{
          'font-family': 'cyberreader, body',
          'font-weight': '420',
          'letter-spacing': '-0.018em',
          'line-height': 1.4,
          margin: '0',
          position: 'relative',
          'z-index': 1,
        }}
      >
        &ldquo;{props.card.quote}&rdquo;
      </blockquote>
      <figcaption
        class="home-quote-card-caption"
        style={{
          'align-items': 'center',
          display: 'flex',
          gap: '12px',
          position: 'relative',
          'z-index': 1,
        }}
      >
        <Show when={props.card.Logo}>
          {(Logo) => (
            <Dynamic
              component={Logo()}
              aria-hidden="true"
              viewBox="0 0 169 40"
              style={{
                color: 'var(--b0)',
                display: 'block',
                flex: 'none',
                height: '28px',
                overflow: 'visible',
                width: 'auto',
              }}
            />
          )}
        </Show>
        <div style={{ display: 'grid', gap: '2px' }}>
          <span
            style={{
              'font-family': 'body',
              'font-size': '16px',
              'font-weight': '700',
              'line-height': 1.25,
            }}
          >
            {props.card.name}
          </span>
          <span
            style={{
              'font-family': 'body',
              'font-size': '14px',
              'font-weight': '500',
              'line-height': 1.25,
              opacity: 0.65,
            }}
          >
            {props.card.role}
          </span>
        </div>
      </figcaption>
    </figure>
  );
}

function TweetQuoteCard() {
  return (
    <div
      class="home-quote-tweet-card"
      style={{
        ...tweetCardChrome,
        'box-sizing': 'border-box',
        display: 'grid',
        height: '100%',
        width: '100%',
      }}
    >
      <a
        href={tweetQuote.href}
        rel="noopener noreferrer"
        target="_blank"
        class="home-quote-tweet-author"
        style={{
          'align-items': 'center',
          color: 'inherit',
          display: 'flex',
          gap: '12px',
          'text-decoration': 'none',
        }}
      >
        <img
          alt=""
          aria-hidden="true"
          height={44}
          src={tweetQuote.avatar}
          width={44}
          style={{
            'border-radius': '50%',
            display: 'block',
            flex: 'none',
            height: '44px',
            'object-fit': 'cover',
            width: '44px',
          }}
        />
        <div style={{ display: 'grid', gap: '2px' }}>
          <span
            style={{
              'align-items': 'center',
              color: 'var(--c1)',
              display: 'inline-flex',
              'font-family': 'body',
              'font-size': '16px',
              'font-weight': '700',
              gap: '8px',
              'line-height': 1.25,
            }}
          >
            {tweetQuote.name}
            <IconTwitter
              aria-hidden="true"
              style={{
                color: 'color-mix(in srgb, var(--c4) 70%, transparent)',
                display: 'block',
                height: '14px',
                width: '14px',
              }}
            />
          </span>
          <span
            style={{
              color: 'color-mix(in srgb, var(--c4) 78%, transparent)',
              'font-family': 'body',
              'font-size': '14px',
              'font-weight': '500',
              'line-height': 1.25,
            }}
          >
            {tweetQuote.handle}
          </span>
        </div>
      </a>
      <blockquote
        class="home-quote-tweet-quote"
        style={{
          color: 'var(--c1)',
          'font-family': 'cyberreader, body',
          'font-weight': '420',
          'letter-spacing': '-0.014em',
          'line-height': 1.45,
          margin: '0',
        }}
      >
        &ldquo;{tweetQuote.beforeMention}
        <a
          href={tweetQuote.mentionHref}
          rel="noopener noreferrer"
          target="_blank"
          style={{
            color: 'var(--a0)',
            'text-decoration': 'none',
          }}
        >
          {tweetQuote.mention}
        </a>
        {tweetQuote.afterMention}&rdquo;
      </blockquote>
    </div>
  );
}

export function SectionHomeQuote(props: { variant?: 'default' | 'migrate' }) {
  const [caseStudyOpen, setCaseStudyOpen] = createSignal(false);
  const [activeQuote, setActiveQuote] = createSignal(0);
  let quoteCarousel: InfiniteCarouselHandle | undefined;

  return (
    <section
      aria-label="Customer quotes"
      class="home-quote-section"
      classList={{ 'home-quote-section--migrate': props.variant === 'migrate' }}
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        width: '100%',
      }}
    >
      <style>{`
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           build-time prerender paints correctly on phones before the JS
           bundle loads. */
        .home-quote-section { gap: 24px; padding: 76px 24px; }
        .home-quote-section--migrate { gap: 40px; padding: 46px 0 72px; }
        .home-quote-frame { gap: 14px; padding: 14px; }
        .home-quote-card-row {
          gap: 14px;
          grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        }
        .home-quote-card { min-height: 320px; padding: 32px 28px; }
        .home-quote-card-quote { font-size: 28px; }
        .home-quote-card-caption { margin-top: 36px; }
        .home-quote-tweet-card {
          align-items: center;
          gap: 20px;
          grid-template-columns: auto minmax(0, 1fr);
          padding: 33px 28px;
        }
        .home-quote-tweet-author { min-width: 200px; }
        .home-quote-tweet-quote { font-size: 22px; }
        .home-quote-footer {
          align-items: center;
          flex-direction: row;
          font-size: 15px;
          gap: 24px;
        }
        /* The middle card is nudged down 28px, so the widest gap is padded
           to match the 72px the button has below it. */
        .home-quote-migrate-stack { gap: 100px; }
        .home-quote-migrate-grid {
          gap: 16px;
          grid-template-columns: minmax(0, 1.08fr) minmax(0, 0.96fr) minmax(0, 0.9fr);
          max-width: none;
        }
        .home-quote-migrate-card { gap: 16px; padding: 18px 18px; }
        .home-quote-migrate-card--nudge { transform: translateY(28px); }
        .home-quote-migrate-quote { font-size: 16px; }
        .home-quote-dialog { padding: 42px; }
        @media (max-width: 899px) {
          .home-quote-card-row { grid-template-columns: 1fr; }
          .home-quote-footer {
            align-items: start;
            flex-direction: column;
            gap: 10px;
          }
          .home-quote-migrate-stack { gap: 72px; }
          .home-quote-migrate-grid {
            gap: 14px;
            grid-template-columns: minmax(0, 1fr);
            max-width: 620px;
          }
          .home-quote-migrate-card--nudge { transform: none; }
        }
        @media (max-width: 699px) {
          .home-quote-section { gap: 20px; padding: 60px 18px; }
          .home-quote-section--migrate { gap: 28px; padding: 34px 6px 48px; }
          .home-quote-frame { gap: 12px; padding: 12px; }
          .home-quote-card-row { gap: 12px; }
          .home-quote-card { min-height: 260px; padding: 24px 22px; }
          .home-quote-card-quote { font-size: 22px; }
          .home-quote-card-caption { margin-top: 28px; }
          .home-quote-tweet-card {
            align-items: start;
            gap: 16px;
            grid-template-columns: 1fr;
            padding: 27px 20px;
          }
          .home-quote-tweet-author { min-width: 0; }
          .home-quote-tweet-quote { font-size: 18px; }
          .home-quote-footer { font-size: 14px; }
          .home-quote-migrate-stack { gap: 36px; }
          .home-quote-migrate-grid { gap: 12px; }
          .home-quote-migrate-card { gap: 14px; padding: 16px 16px; }
          .home-quote-migrate-quote { font-size: 15px; }
          .home-quote-dialog { padding: 18px; }
          .home-quote-mobile-wrap {
            display: grid;
            gap: 16px;
            margin-inline: -18px;
            overflow: hidden;
            width: calc(100% + 36px);
          }
          .home-quote-mobile-carousel {
            -ms-overflow-style: none;
            scrollbar-width: none;
          }
          .home-quote-mobile-carousel::-webkit-scrollbar { display: none; }
        }
      `}</style>
      <Show
        when={props.variant === 'migrate'}
        fallback={
          <>
            <SsgDesktop>
              <div
                class="home-quote-frame"
                style={{
                  'backdrop-filter': 'blur(6px)',
                  '-webkit-backdrop-filter': 'blur(6px)',
                  'background-color':
                    'color-mix(in srgb, var(--b1) 86%, transparent)',
                  'border-radius': '20px',
                  'box-shadow': '0 14px 32px -22px rgb(0 0 0 / 0.55)',
                  'box-sizing': 'border-box',
                  display: 'grid',
                  'max-width': 'var(--page-max)',
                  'margin-inline': 'auto',
                  position: 'relative',
                  width: '100%',
                }}
              >
                <div
                  class="home-quote-card-row"
                  style={{
                    display: 'grid',
                    width: '100%',
                  }}
                >
                  <For each={cards}>
                    {(card) => <QuoteFigure card={card} />}
                  </For>
                </div>
                <TweetQuoteCard />
              </div>
            </SsgDesktop>
            <SsgMobile>
              <div class="home-quote-mobile-wrap">
                <InfiniteCarousel
                  ariaLabel="Customer quotes"
                  class="home-quote-mobile-carousel no-scrollbar"
                  items={homeQuoteSlides}
                  onActiveChange={setActiveQuote}
                  onReady={(handle) => {
                    quoteCarousel = handle;
                  }}
                  style={{
                    'align-items': 'stretch',
                    display: 'flex',
                    overflow: 'auto',
                    'overscroll-behavior-x': 'contain',
                    padding: '0',
                    'scroll-behavior': 'smooth',
                    'scroll-snap-type': 'x mandatory',
                    width: '100%',
                  }}
                >
                  {(slide, context) => (
                    <article
                      aria-hidden={context.isClone()}
                      id={
                        context.isClone()
                          ? undefined
                          : `home-quote-slide-${context.logicalIndex()}`
                      }
                      style={{
                        'box-sizing': 'border-box',
                        display: 'flex',
                        flex: '0 0 calc(100% - 64px)',
                        margin: '0 10px',
                        'min-width': '0',
                        'scroll-snap-align': 'center',
                        'scroll-snap-stop': 'always',
                      }}
                    >
                      <Show
                        when={slide.kind === 'quote' && slide.card}
                        fallback={<TweetQuoteCard />}
                      >
                        {(card) => <QuoteFigure card={card()} />}
                      </Show>
                    </article>
                  )}
                </InfiniteCarousel>
                <div
                  aria-label="Customer quotes"
                  style={{
                    display: 'flex',
                    gap: '8px',
                    'justify-content': 'center',
                  }}
                >
                  <For each={homeQuoteSlides}>
                    {(slide, index) => (
                      <button
                        aria-controls={`home-quote-slide-${index()}`}
                        aria-label={
                          slide.kind === 'quote'
                            ? `Show quote from ${slide.card.name}`
                            : `Show quote from ${tweetQuote.name}`
                        }
                        aria-pressed={activeQuote() === index()}
                        onClick={() => quoteCarousel?.select(index())}
                        style={{
                          background:
                            activeQuote() === index()
                              ? 'var(--a0)'
                              : 'color-mix(in srgb, var(--c4) 34%, transparent)',
                          border: '0',
                          'border-radius': '999px',
                          cursor: 'pointer',
                          height: '7px',
                          padding: '0',
                          transition:
                            'background-color 180ms ease, transform 180ms ease, width 180ms ease',
                          width: activeQuote() === index() ? '24px' : '7px',
                        }}
                        type="button"
                      />
                    )}
                  </For>
                </div>
              </div>
            </SsgMobile>
            <SsgDesktop>
              <div
                class="home-quote-footer"
                style={{
                  color: 'color-mix(in srgb, var(--c4) 78%, transparent)',
                  display: 'flex',
                  'font-family': 'body',
                  'font-weight': '500',
                  'justify-content': 'space-between',
                  'line-height': 1.45,
                  'max-width': 'var(--page-max)',
                  'margin-inline': 'auto',
                  width: '100%',
                }}
              >
                <p
                  style={{
                    margin: '0',
                    'max-width': '52ch',
                    'padding-left': '20px',
                  }}
                >
                  Macro is the open-source workspace for ambitious teams.
                </p>
                <button
                  type="button"
                  onClick={() => setCaseStudyOpen(true)}
                  style={{
                    background: 'none',
                    border: '0',
                    color: 'inherit',
                    cursor: 'pointer',
                    'font-family': 'inherit',
                    'font-size': 'inherit',
                    'font-weight': '600',
                    'line-height': 'inherit',
                    margin: '0',
                    padding: '0 20px 0 0',
                    'text-align': 'inherit',
                    'text-decoration': 'none',
                    'white-space': 'nowrap',
                  }}
                >
                  Watch the case study →
                </button>
              </div>
            </SsgDesktop>
          </>
        }
      >
        <div
          class="home-quote-migrate-stack"
          style={{
            display: 'grid',
            'justify-items': 'center',
            'margin-inline': 'auto',
            'max-width': 'var(--page-max)',
            width: '100%',
          }}
        >
          <div
            class="home-quote-migrate-grid"
            style={{
              'align-items': 'start',
              display: 'grid',
              'margin-inline': 'auto',
              width: '100%',
            }}
          >
            <For each={migrateCards}>
              {(card, index) => (
                <figure
                  class="home-quote-migrate-card"
                  classList={{
                    'home-quote-migrate-card--nudge': index() === 1,
                  }}
                  style={{
                    ...tweetCardChrome,
                    'box-sizing': 'border-box',
                    color: 'var(--c1)',
                    display: 'grid',
                    margin: '0',
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      'align-items': 'center',
                      display: 'flex',
                      gap: '12px',
                      'min-width': '0',
                    }}
                  >
                    <Show
                      when={card.avatar}
                      fallback={
                        <Show
                          when={card.Logo}
                          fallback={
                            <span
                              aria-hidden="true"
                              style={{
                                'align-items': 'center',
                                background:
                                  'color-mix(in srgb, var(--c4) 12%, var(--b1))',
                                'border-radius': '50%',
                                color: 'var(--c2)',
                                display: 'inline-flex',
                                flex: 'none',
                                'font-family': 'body',
                                'font-size': '15px',
                                'font-weight': '700',
                                height: '42px',
                                'justify-content': 'center',
                                width: '42px',
                              }}
                            >
                              {card.name.charAt(0)}
                            </span>
                          }
                        >
                          {(Logo) => (
                            <span
                              style={{
                                'align-items': 'center',
                                display: 'inline-flex',
                                flex: 'none',
                                height: '42px',
                                width: '66px',
                              }}
                            >
                              <Dynamic
                                component={Logo()}
                                aria-hidden="true"
                                viewBox="0 0 169 40"
                                style={{
                                  color: 'var(--c1)',
                                  display: 'block',
                                  height: 'auto',
                                  overflow: 'visible',
                                  width: '66px',
                                }}
                              />
                            </span>
                          )}
                        </Show>
                      }
                    >
                      {(avatar) => (
                        <img
                          alt=""
                          aria-hidden="true"
                          height={42}
                          src={avatar()}
                          width={42}
                          style={{
                            'border-radius': '50%',
                            display: 'block',
                            flex: 'none',
                            height: '42px',
                            'object-fit': 'cover',
                            width: '42px',
                          }}
                        />
                      )}
                    </Show>
                    <Dynamic
                      component={card.href ? 'a' : 'div'}
                      href={card.href}
                      rel={card.href ? 'noopener noreferrer' : undefined}
                      target={card.href ? '_blank' : undefined}
                      style={{
                        color: 'inherit',
                        display: 'grid',
                        gap: '2px',
                        'min-width': '0',
                        'text-decoration': 'none',
                      }}
                    >
                      <span
                        style={{
                          color: 'var(--c1)',
                          'font-family': 'body',
                          'font-size': '18px',
                          'font-weight': '700',
                          'line-height': 1.2,
                        }}
                      >
                        {card.name}
                      </span>
                      <span
                        style={{
                          color:
                            'color-mix(in srgb, var(--c4) 78%, transparent)',
                          'font-family': 'body',
                          'font-size': '12px',
                          'font-weight': '500',
                          'line-height': 1.3,
                        }}
                      >
                        {card.role}
                      </span>
                    </Dynamic>
                  </div>
                  <blockquote
                    class="home-quote-migrate-quote"
                    style={{
                      color: 'var(--c1)',
                      'font-family': 'cyberreader, body',
                      'font-weight': '420',
                      'letter-spacing': '-0.012em',
                      'line-height': 1.45,
                      margin: '0',
                      'text-wrap': 'pretty',
                    }}
                  >
                    &ldquo;
                    <Show when={card.mention} fallback={card.quote}>
                      {(mention) => (
                        <>
                          {mention().before}
                          <a
                            href={mention().href}
                            rel="noopener noreferrer"
                            target="_blank"
                            style={{
                              color: 'var(--a0)',
                              'text-decoration': 'none',
                            }}
                          >
                            {mention().label}
                          </a>
                          {mention().after}
                        </>
                      )}
                    </Show>
                    &rdquo;
                  </blockquote>
                </figure>
              )}
            </For>
          </div>
        </div>
      </Show>

      <Show when={caseStudyOpen()}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Desync case study video"
          onClick={() => setCaseStudyOpen(false)}
          class="home-quote-dialog"
          style={{
            'align-items': 'center',
            background: 'oklch(from var(--b0) l c h / 0.86)',
            display: 'grid',
            inset: '0',
            'justify-items': 'center',
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
              'box-shadow': 'var(--shadow-panel-xl)',
              'box-sizing': 'border-box',
              display: 'grid',
              'max-width': '1040px',
              position: 'relative',
              width: 'min(100%, 1040px)',
            }}
          >
            <button
              type="button"
              aria-label="Close video"
              onClick={() => setCaseStudyOpen(false)}
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
            <video
              autoplay
              controls
              playsinline
              poster={markDesyncPlaceholder}
              preload="metadata"
              src={desyncVideoUrl}
              style={{
                'aspect-ratio': '16 / 9',
                background: 'var(--b1)',
                display: 'block',
                height: 'auto',
                'max-height': 'calc(100vh - 96px)',
                'object-fit': 'contain',
                width: '100%',
              }}
            />
          </div>
        </div>
      </Show>
    </section>
  );
}
