import { A, useSearchParams } from '@solidjs/router';
import {
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  Show,
} from 'solid-js';
import { setPageSeo } from '../../app/utils/utilSeo';
import IconSearch from '../../assets/icons/icon-search.svg';
import { postGraphics } from './PostGraphics';
import { PostsPageTail } from './PostsPageTail';
import {
  avoidTitleOrphan,
  collectAllTags,
  formatTagLabel,
  normalizeTag,
  postHasTag,
  posts,
} from './registry';
import './posts-shell.css';

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** Format `YYYY-MM-DD` as "Mon D, YYYY". */
function shortDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mm, dd] = m;
  return `${MONTHS_SHORT[Number(mm) - 1]} ${Number(dd)}, ${y}`;
}

export default function PostsIndex() {
  const [searchParams] = useSearchParams<{ tag?: string }>();
  const [query, setQuery] = createSignal('');

  const activeTag = createMemo(() => normalizeTag(searchParams.tag ?? ''));
  const allTags = createMemo(() => collectAllTags(posts));
  const visiblePosts = createMemo(() => {
    const tag = activeTag();
    const q = query().trim().toLowerCase();
    return posts.filter((post) => {
      if (tag && !postHasTag(post.meta, tag)) return false;
      if (q) {
        const hay =
          `${post.meta.title} ${post.meta.titleLine2 ?? ''} ${post.meta.preview ?? ''} ${post.meta.description ?? ''} ${(post.meta.tags ?? []).join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  // Render effect (not createEffect) so it also runs during prerendering.
  createRenderEffect(() => {
    const tag = activeTag();
    setPageSeo({
      title: tag ? `Blog · ${formatTagLabel(tag)} · Macro` : 'Blog · Macro',
      description:
        'Writing from Macro: notes on product, engineering, management, and the software companies we learn from.',
      // Tag filters are views of the same list; canonicalize to /posts.
      path: '/posts',
    });
  });

  return (
    <>
      <main class="posts-shell posts-index-shell posts-index-shell--with-tail">
        <header class="posts-index-hero">
          <h1>The Macro Blog</h1>
          <p class="posts-index-sub">
            Posts from our team about why we build Macro, how we dogfood, and
            the engineering behind it.
          </p>
        </header>

        <div class="post-toolbar">
          <Show when={allTags().length > 0}>
            <nav aria-label="Filter by category" class="post-filter">
              <A
                class="post-filter-link"
                classList={{ 'post-filter-link--active': !activeTag() }}
                href="/posts"
              >
                All
              </A>
              <For each={allTags()}>
                {(tag) => (
                  <A
                    class="post-filter-link"
                    classList={{
                      'post-filter-link--active': activeTag() === tag,
                    }}
                    href={
                      activeTag() === tag
                        ? '/posts'
                        : `/posts?tag=${encodeURIComponent(tag)}`
                    }
                  >
                    {formatTagLabel(tag)}
                  </A>
                )}
              </For>
            </nav>
          </Show>

          <label class="post-search">
            <IconSearch class="post-search-icon" aria-hidden="true" />
            <input
              type="search"
              placeholder="Search…"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              aria-label="Search posts"
            />
          </label>
        </div>

        <Show
          when={visiblePosts().length > 0}
          fallback={<p class="post-empty">No posts match your search.</p>}
        >
          <ul class="post-grid">
            <For each={visiblePosts()}>
              {(post) => {
                const Graphic = postGraphics[post.meta.slug];
                const category =
                  post.meta.category ??
                  (post.meta.tags?.[0]
                    ? formatTagLabel(post.meta.tags[0])
                    : 'Post');
                const bylineLead = post.meta.author?.name ?? category;
                const date = shortDate(post.meta.date);
                return (
                  <li class="post-card">
                    <A href={`/posts/${post.meta.slug}`} class="post-card-link">
                      <div class="post-card-graphic" aria-hidden="true">
                        {Graphic ? <Graphic height="64px" /> : null}
                      </div>
                      <div class="post-card-text">
                        <h2 class="post-card-title">
                          {avoidTitleOrphan(
                            post.meta.titleLine2
                              ? `${post.meta.title} ${post.meta.titleLine2}`
                              : post.meta.title
                          )}
                        </h2>
                        <Show when={post.meta.preview ?? post.meta.description}>
                          <p class="post-card-desc">
                            {post.meta.preview ?? post.meta.description}
                          </p>
                        </Show>
                      </div>
                      <div class="post-card-byline">
                        <span>{bylineLead}</span>
                        <Show when={date}>
                          <span class="post-card-dot">·</span>
                          <span>{date}</span>
                        </Show>
                      </div>
                    </A>
                  </li>
                );
              }}
            </For>
          </ul>
        </Show>
      </main>
      <PostsPageTail ctaButtonName="blog_index_cta" />
    </>
  );
}
