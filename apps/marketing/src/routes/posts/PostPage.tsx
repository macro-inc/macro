import { A, useParams } from '@solidjs/router';
import { createMemo, createRenderEffect, Show } from 'solid-js';
import { Dynamic, isServer } from 'solid-js/web';
import { APP_BASE_URL } from '../../app/utils/utilBaseUrl';
import { setPageSeo } from '../../app/utils/utilSeo';
import { FeatureUiStyles } from '../../features/marketing/components/FeaturePage';
import { PostCover } from './PostCover';
import { PostsPageTail } from './PostsPageTail';
import { avoidTitleOrphan, getPostBySlug } from './registry';
import './posts-shell.css';
import './post-reading.css';

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
      title: `${e.meta.seoTitle ?? e.meta.title} · Rox`,
      description:
        e.meta.description ?? `${e.meta.title} — writing from the team at Rox.`,
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
            <article
              class="posts-shell posts-article posts-article--with-footer"
              classList={{ 'posts-article--video': !!e().meta.heroVideo }}
            >
              <FeatureUiStyles />
              <header class="posts-article-header">
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

                <Show
                  when={e().meta.heroVideo}
                  fallback={
                    <div class="posts-hero-art">
                      <PostCover brand={e().meta.coverBrand} />
                    </div>
                  }
                >
                  {(video) => (
                    <figure class="posts-hero-video">
                      <iframe
                        src={`https://www.youtube.com/embed/${video().id}?rel=0`}
                        title={video().title}
                        loading="lazy"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowfullscreen
                      />
                      <Show when={video().caption}>
                        {(caption) => <figcaption>{caption()}</figcaption>}
                      </Show>
                    </figure>
                  )}
                </Show>

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
            <PostsPageTail />
          </>
        );
      }}
    </Show>
  );
}
