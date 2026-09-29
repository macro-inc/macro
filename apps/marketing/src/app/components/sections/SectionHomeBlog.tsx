import { A } from '@solidjs/router';
import {
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { postGraphics } from '../../../routes/posts/PostGraphics';
import { avoidTitleOrphan, posts } from '../../../routes/posts/registry';
import {
  InfiniteCarousel,
  type InfiniteCarouselHandle,
} from '../utils/InfiniteCarousel';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';
import '../../../routes/posts/posts-shell.css';

type HomePost = (typeof posts)[number];

function HomeBlogCard(props: { post: HomePost }) {
  const Graphic = postGraphics[props.post.meta.slug];

  return (
    <A href={`/posts/${props.post.meta.slug}`} class="post-card-link">
      <div class="post-card-graphic" aria-hidden="true">
        {Graphic ? <Graphic height="64px" /> : null}
      </div>
      <div class="post-card-text">
        <h2 class="post-card-title">
          {avoidTitleOrphan(
            props.post.meta.titleLine2
              ? `${props.post.meta.title} ${props.post.meta.titleLine2}`
              : props.post.meta.title
          )}
        </h2>
        <Show when={props.post.meta.preview ?? props.post.meta.description}>
          <p class="post-card-desc">
            {props.post.meta.preview ?? props.post.meta.description}
          </p>
        </Show>
      </div>
    </A>
  );
}

function CarouselCaret(props: { direction: 'left' | 'right' }) {
  return (
    <svg
      aria-hidden="true"
      height="18"
      viewBox="0 0 24 24"
      width="18"
      style={{ display: 'block' }}
    >
      <path
        d={
          props.direction === 'left'
            ? 'M14.5 5.5 8 12l6.5 6.5'
            : 'M9.5 5.5 16 12l-6.5 6.5'
        }
        fill="none"
        stroke="currentColor"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
      />
    </svg>
  );
}

export function SectionHomeBlog() {
  // Posts opt in to the homepage; `hideFromHome` ones stay on /posts only.
  const homePosts = createMemo(() => posts.filter((p) => !p.meta.hideFromHome));
  const [activePost, setActivePost] = createSignal(0);
  const [atStart, setAtStart] = createSignal(true);
  const [atEnd, setAtEnd] = createSignal(false);
  let carousel: InfiniteCarouselHandle | undefined;
  let desktopTrack: HTMLUListElement | undefined;

  const syncDesktopEdges = () => {
    const track = desktopTrack;
    if (!track) return;
    const max = track.scrollWidth - track.clientWidth;
    setAtStart(track.scrollLeft <= 4);
    setAtEnd(max <= 4 || track.scrollLeft >= max - 4);
  };

  const scrollDesktopByCard = (direction: -1 | 1) => {
    const track = desktopTrack;
    if (!track) return;
    const card = track.querySelector<HTMLElement>('.home-blog-desktop-card');
    if (!card) return;
    track.scrollBy({ left: card.offsetWidth * direction, behavior: 'smooth' });
  };

  onMount(() => {
    syncDesktopEdges();
    const track = desktopTrack;
    if (!track || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncDesktopEdges);
    observer.observe(track);
    onCleanup(() => observer.disconnect());
  });

  return (
    <section
      aria-label="From the Macro blog"
      class="home-blog-section posts-shell"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'stretch',
        width: '100%',
      }}
    >
      <style>{`
        /* Viewport-dependent styling lives in CSS (not JS ternaries) so the
           build-time prerender paints correctly on phones before the JS
           bundle loads. */
        /* One rhythm for: top -> title -> cards -> (view all) -> bottom. */
        .home-blog-section {
          gap: 48px;
          padding-block: 80px;
          padding-inline: 24px;
        }
        .home-blog-section > a.home-blog-title {
          font-size: 36px;
          margin-left: 0;
          margin-bottom: 0;
        }
        @media (max-width: 699px) {
          .home-blog-section {
            gap: 36px;
            padding-block: 80px;
            padding-inline: 18px;
          }
          .home-blog-section > a.home-blog-title {
            font-size: 34px;
            margin-left: 22px;
            margin-bottom: 12px;
          }
        }
        .home-blog-section > a.home-blog-title,
        .home-blog-section a.home-blog-view-all {
          color: var(--c0);
          justify-self: start;
          text-decoration: none;
          transition: color 160ms ease;
        }
        @media (hover) {
          .home-blog-section > a.home-blog-title:hover,
          .home-blog-section a.home-blog-view-all:hover {
            color: var(--a0);
          }
        }
        .home-blog-desktop-carousel {
          --home-blog-cards-visible: 3.35;
          --post-rule: color-mix(in srgb, var(--b4) 22%, transparent);
          display: grid;
          gap: 16px;
          min-width: 0;
        }
        .home-blog-desktop-viewport {
          min-width: 0;
          position: relative;
        }
        .home-blog-desktop-viewport::after {
          background: linear-gradient(
            to right,
            transparent 0%,
            color-mix(in srgb, var(--b0) 18%, transparent) 42%,
            var(--b0) 100%
          );
          bottom: 0;
          content: '';
          opacity: 1;
          pointer-events: none;
          position: absolute;
          right: 0;
          top: 0;
          transition: opacity 180ms ease;
          width: 112px;
          z-index: 1;
        }
        .home-blog-desktop-viewport.is-at-end::after {
          opacity: 0;
        }
        .home-blog-desktop-track {
          -ms-overflow-style: none;
          display: flex;
          list-style: none;
          margin: 0;
          min-width: 0;
          overflow-x: auto;
          overscroll-behavior-x: contain;
          padding: 0;
          scrollbar-width: none;
          scroll-behavior: smooth;
          scroll-snap-type: x mandatory;
        }
        .home-blog-desktop-track::-webkit-scrollbar { display: none; }
        .home-blog-desktop-track .home-blog-desktop-card,
        .home-blog-desktop-track .home-blog-desktop-card:first-child,
        .home-blog-desktop-track .home-blog-desktop-card:nth-child(2n),
        .home-blog-desktop-track .home-blog-desktop-card:nth-child(2n + 1),
        .home-blog-desktop-track .home-blog-desktop-card:nth-child(3n),
        .home-blog-desktop-track .home-blog-desktop-card:nth-child(3n + 1),
        .home-blog-desktop-track .home-blog-desktop-card:nth-child(-n + 2),
        .home-blog-desktop-track .home-blog-desktop-card:nth-child(-n + 3) {
          border-left: 1px solid var(--post-rule);
          border-top: 0;
          box-sizing: border-box;
          flex: 0 0 calc(100% / var(--home-blog-cards-visible));
          padding: 0 34px;
          scroll-snap-align: start;
          scroll-snap-stop: always;
        }
        .home-blog-desktop-track .home-blog-desktop-card:first-child {
          border-left: 0;
          padding-left: 0;
        }
        .home-blog-desktop-track .home-blog-desktop-card:last-child {
          padding-right: 0;
        }
        @media (max-width: 980px) {
          .home-blog-desktop-carousel {
            --home-blog-cards-visible: 2.35;
          }
          .home-blog-desktop-track .home-blog-desktop-card,
          .home-blog-desktop-track .home-blog-desktop-card:first-child,
          .home-blog-desktop-track .home-blog-desktop-card:nth-child(2n),
          .home-blog-desktop-track .home-blog-desktop-card:nth-child(2n + 1),
          .home-blog-desktop-track .home-blog-desktop-card:nth-child(3n),
          .home-blog-desktop-track .home-blog-desktop-card:nth-child(3n + 1),
          .home-blog-desktop-track .home-blog-desktop-card:nth-child(-n + 2),
          .home-blog-desktop-track .home-blog-desktop-card:nth-child(-n + 3) {
            flex-basis: calc(100% / var(--home-blog-cards-visible));
            padding: 0 30px;
          }
          .home-blog-desktop-track .home-blog-desktop-card:first-child {
            padding-left: 0;
          }
          .home-blog-desktop-track .home-blog-desktop-card:last-child {
            padding-right: 0;
          }
        }
        .home-blog-desktop-controls {
          align-items: center;
          display: flex;
          gap: 6px;
          justify-content: flex-end;
        }
        .home-blog-desktop-controls button {
          background: transparent;
          border: 0;
          color: var(--c4);
          cursor: default;
          display: inline-flex;
          padding: 3px;
          transition: color 160ms ease;
        }
        .home-blog-desktop-controls button:hover:not(:disabled) { color: var(--c1); }
        .home-blog-desktop-controls button:disabled { opacity: 0.35; }
        @media (prefers-reduced-motion: reduce) {
          .home-blog-desktop-track { scroll-behavior: auto; }
        }
        .home-blog-mobile-carousel {
          display: grid;
          gap: 16px;
          margin-inline: -18px;
          overflow: hidden;
          width: calc(100% + 36px);
        }
        .home-blog-mobile-track {
          -ms-overflow-style: none;
          box-sizing: border-box;
          display: flex;
          overflow: auto;
          overscroll-behavior-x: contain;
          padding: 0 18px;
          scrollbar-width: none;
          scroll-behavior: smooth;
          scroll-snap-type: x mandatory;
          width: 100%;
        }
        .home-blog-mobile-track::-webkit-scrollbar { display: none; }
        .home-blog-mobile-track .home-blog-mobile-card {
          background:
            radial-gradient(130% 96% at 8% 0%, color-mix(in srgb, var(--ambient-ink) 8%, transparent) 0%, transparent 54%),
            linear-gradient(145deg, color-mix(in srgb, var(--b2) 88%, var(--b0)) 0%, color-mix(in srgb, var(--b1) 94%, var(--b0)) 100%);
          border: 1px solid color-mix(in srgb, var(--b4) 28%, transparent);
          border-radius: 16px;
          box-sizing: border-box;
          display: block;
          flex: 0 0 calc(100% - 48px);
          margin: 0 14px 0 0;
          min-width: 0;
          padding: 20px;
          scroll-snap-align: center;
          scroll-snap-stop: always;
          width: calc(100% - 48px);
        }
        .home-blog-mobile-track .home-blog-mobile-card:first-child {
          border-top: 1px solid color-mix(in srgb, var(--b4) 28%, transparent);
          padding-top: 20px;
        }
        .home-blog-mobile-track .post-card-graphic {
          background: transparent;
          box-shadow: none;
          height: 146px;
        }
        .home-blog-mobile-track .post-card-desc {
          -webkit-line-clamp: 3;
        }
        .home-blog-mobile-track .post-card-text { gap: 8px; }
        .home-blog-mobile-dots { display: flex; gap: 8px; justify-content: center; }
        .home-blog-mobile-dots button {
          background: color-mix(in srgb, var(--c4) 34%, transparent);
          border: 0;
          border-radius: 999px;
          cursor: pointer;
          height: 7px;
          padding: 0;
          transition: background-color 180ms ease, width 180ms ease;
          width: 7px;
        }
        .home-blog-mobile-dots button[aria-pressed="true"] {
          background: var(--a0);
          width: 24px;
        }
      `}</style>
      <A
        href="/posts"
        class="home-blog-title"
        style={{
          'font-family': 'display',
          'font-weight': '420',
          'letter-spacing': '-0.015em',
          'line-height': 1.1,
          'text-wrap': 'balance',
        }}
      >
        From the Macro blog
      </A>
      <SsgDesktop>
        <div class="home-blog-desktop-carousel">
          <div
            class="home-blog-desktop-viewport"
            classList={{ 'is-at-end': atEnd() }}
          >
            <ul
              aria-label="Macro blog posts"
              class="home-blog-desktop-track"
              onScroll={syncDesktopEdges}
              ref={(el) => {
                desktopTrack = el;
              }}
            >
              <For each={homePosts()}>
                {(post) => (
                  <li class="post-card home-blog-desktop-card">
                    <HomeBlogCard post={post} />
                  </li>
                )}
              </For>
            </ul>
          </div>
          <div class="home-blog-desktop-controls">
            <button
              aria-label="Previous posts"
              disabled={atStart()}
              onClick={() => scrollDesktopByCard(-1)}
              type="button"
            >
              <CarouselCaret direction="left" />
            </button>
            <button
              aria-label="Next posts"
              disabled={atEnd()}
              onClick={() => scrollDesktopByCard(1)}
              type="button"
            >
              <CarouselCaret direction="right" />
            </button>
          </div>
        </div>
      </SsgDesktop>
      <SsgMobile>
        <div class="home-blog-mobile-carousel">
          <InfiniteCarousel
            ariaLabel="Macro blog posts"
            class="home-blog-mobile-track"
            items={homePosts()}
            onActiveChange={setActivePost}
            onReady={(handle) => {
              carousel = handle;
            }}
          >
            {(post, context) => (
              <article
                aria-hidden={context.isClone()}
                class="post-card home-blog-mobile-card"
              >
                <HomeBlogCard post={post} />
              </article>
            )}
          </InfiniteCarousel>
          <div aria-label="Blog posts" class="home-blog-mobile-dots">
            <For each={homePosts()}>
              {(post, index) => (
                <button
                  aria-label={`Show ${post.meta.title}`}
                  aria-pressed={activePost() === index()}
                  onClick={() => carousel?.select(index())}
                  type="button"
                />
              )}
            </For>
          </div>
        </div>
      </SsgMobile>
      <SsgMobile>
        <A
          href="/posts"
          class="home-blog-view-all"
          style={{
            'font-family': 'body',
            'font-size': '15px',
            'font-weight': '600',
            'justify-self': 'center',
            'letter-spacing': '0.01em',
            'line-height': 1.2,
          }}
        >
          View all →
        </A>
      </SsgMobile>
    </section>
  );
}
