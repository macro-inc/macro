import ArrowLeft from '@phosphor/arrow-left.svg';
import ArrowRight from '@phosphor/arrow-right.svg';
import ArticleIcon from '@phosphor/article.svg';
import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { homePosts } from '../../../../marketing/src/routes/posts/homePosts';
import { postGraphics } from '../../../../marketing/src/routes/posts/PostGraphics';
import './homepage-closing-content.css';

export function HomepageBlog() {
  let track!: HTMLUListElement;
  const [atStart, setAtStart] = createSignal(true);
  const [atEnd, setAtEnd] = createSignal(false);
  const syncEdges = () => {
    setAtStart(track.scrollLeft <= 4);
    setAtEnd(track.scrollLeft >= track.scrollWidth - track.clientWidth - 4);
  };
  const move = (direction: number) => {
    const cards = Array.from(track.children) as HTMLElement[];
    const first = cards[0];
    if (!first) return;
    const positions = cards.map((card) => card.offsetLeft - first.offsetLeft);
    const next =
      direction > 0
        ? positions.find((left) => left > track.scrollLeft + 4)
        : positions.findLast((left) => left < track.scrollLeft - 4);
    track.scrollTo({
      left: next ?? (direction > 0 ? track.scrollWidth : 0),
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
    });
  };
  onMount(() => {
    syncEdges();
    const observer = new ResizeObserver(syncEdges);
    observer.observe(track);
    onCleanup(() => observer.disconnect());
  });

  return (
    <section
      class="homepage-blog workspace-demo"
      aria-labelledby="homepage-blog-title"
    >
      <header>
        <h2 id="homepage-blog-title">From the Macro blog</h2>
        <a href="/posts">
          View all <ArrowRight aria-hidden="true" />
        </a>
      </header>
      <ul
        class="homepage-blog-track"
        ref={track}
        onScroll={syncEdges}
        onKeyDown={(event) => {
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          event.stopPropagation();
          move(event.key === 'ArrowLeft' ? -1 : 1);
        }}
        aria-label="Macro blog posts"
        tabindex="0"
      >
        <For each={homePosts}>
          {(post) => {
            const Graphic = postGraphics[post.slug];
            return (
              <li>
                <a href={`/posts/${post.slug}`}>
                  <span class="homepage-blog-icon" aria-hidden="true">
                    {Graphic ? <Graphic height="22px" /> : <ArticleIcon />}
                  </span>
                  <h3>
                    {post.title}
                    {post.titleLine2 ? ` ${post.titleLine2}` : ''}
                  </h3>
                </a>
              </li>
            );
          }}
        </For>
      </ul>
      <div class="homepage-blog-controls">
        <button
          type="button"
          aria-label="Previous posts"
          disabled={atStart()}
          onClick={() => move(-1)}
        >
          <ArrowLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Next posts"
          disabled={atEnd()}
          onClick={() => move(1)}
        >
          <ArrowRight aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
