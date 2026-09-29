import { A, useParams } from '@solidjs/router';
import { createMemo, createRenderEffect, Show } from 'solid-js';
import { Dynamic, isServer } from 'solid-js/web';
import { APP_BASE_URL } from '../../app/utils/utilBaseUrl';
import { setPageSeo } from '../../app/utils/utilSeo';
import { PostCover } from './PostCover';
import { PostsPageTail } from './PostsPageTail';
import {
  avoidTitleOrphan,
  EXCLUDED_FILTER_TAGS,
  formatTagLabel,
  getPostBySlug,
} from './registry';
import './posts-shell.css';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Format a `YYYY-MM-DD` string as "Month D, YYYY" (deterministic, no TZ shift). */
function formatPostDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const [, y, mm, dd] = m;
  return `${MONTHS[Number(mm) - 1]} ${Number(dd)}, ${y}`;
}

export default function PostPage() {
  const params = useParams<{ slug: string }>();
  const entry = createMemo(() => getPostBySlug(params.slug));

  // Render effect (not createEffect) so it also runs during prerendering.
  createRenderEffect(() => {
    const e = entry();
    if (!e) {
      if (!isServer) document.title = 'Post not found';
      return;
    }
    setPageSeo({
      title: `${e.meta.seoTitle ?? e.meta.title} · Macro`,
      description:
        e.meta.description ??
        `${e.meta.title} — writing from the team at Macro.`,
      path: `/posts/${e.meta.slug}`,
      type: 'article',
      publishedTime: e.meta.date,
      modifiedTime:
        e.meta.updated && e.meta.updated !== e.meta.date
          ? e.meta.updated
          : undefined,
      image: e.meta.image ? `${APP_BASE_URL}${e.meta.image}` : undefined,
      author: e.meta.author?.name,
    });
  });

  return (
    <Show
      when={entry()}
      fallback={
        <main class="posts-shell posts-not-found">
          <p>No post matches “{params.slug}”.</p>
          <p>
            <A href="/posts">← All posts</A>
          </p>
        </main>
      }
    >
      {(e) => {
        const showUpdated =
          !!e().meta.updated && e().meta.updated !== e().meta.date;
        return (
          <>
            <article class="posts-shell posts-article posts-article--with-footer">
              <header class="posts-article-header">
                <nav class="posts-eyebrow" aria-label="Breadcrumb">
                  <A href="/posts">Blog</A>
                  <Show when={e().meta.category ?? e().meta.tags?.[0]}>
                    {(cat) => {
                      const tagParam = () => {
                        const primary = e().meta.tags?.find(
                          (t) => !EXCLUDED_FILTER_TAGS.has(t.toLowerCase())
                        );
                        return primary ?? cat().toLowerCase();
                      };
                      return (
                        <>
                          <span class="posts-eyebrow-sep">/</span>
                          <A
                            href={`/posts?tag=${encodeURIComponent(tagParam())}`}
                          >
                            {formatTagLabel(cat())}
                          </A>
                        </>
                      );
                    }}
                  </Show>
                </nav>

                <h1 class="posts-title">
                  {avoidTitleOrphan(e().meta.title)}
                  <Show when={e().meta.titleLine2}>
                    {(line2) => (
                      <>
                        <br />
                        <span class="posts-title-line2">
                          {avoidTitleOrphan(line2())}
                        </span>
                      </>
                    )}
                  </Show>
                </h1>

                <Show when={e().meta.subtitle}>
                  {(subtitle) => <p class="posts-lede">{subtitle()}</p>}
                </Show>

                <div class="posts-hero-art">
                  <PostCover brand={e().meta.coverBrand} />
                </div>

                <div class="posts-byline">
                  <Show when={e().meta.author}>
                    {(author) => (
                      <>
                        <Show when={author().avatar}>
                          {(src) => (
                            <img
                              class="posts-byline-avatar"
                              src={src()}
                              alt=""
                              aria-hidden="true"
                            />
                          )}
                        </Show>
                        <span class="posts-byline-name">{author().name}</span>
                      </>
                    )}
                  </Show>
                  <Show when={e().meta.date}>
                    {(d) => (
                      <>
                        <Show when={e().meta.author}>
                          <span class="posts-byline-sep">·</span>
                        </Show>
                        <time dateTime={d()}>{formatPostDate(d())}</time>
                      </>
                    )}
                  </Show>
                </div>
                <Show when={showUpdated}>
                  <p class="posts-updated">
                    Last updated{' '}
                    <time dateTime={e().meta.updated}>
                      {formatPostDate(e().meta.updated)}
                    </time>
                  </p>
                </Show>
              </header>

              <div class="post-body">
                <Dynamic component={e().component} />
              </div>
            </article>
            <PostsPageTail
              ctaButtonName={
                e().meta.ctaButtonName ?? `blog_${e().meta.slug}_cta`
              }
            />
          </>
        );
      }}
    </Show>
  );
}
