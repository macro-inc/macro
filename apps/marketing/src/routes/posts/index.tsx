import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { A } from '@solidjs/router';
import { createRenderEffect, For, Show } from 'solid-js';
import { setPageSeo } from '../../app/utils/utilSeo';
import { postGraphics } from './PostGraphics';
import { PostsPageTail } from './PostsPageTail';
import { posts } from './registry';
import './posts-shell.css';
import './posts-index.css';

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
  createRenderEffect(() => {
    setPageSeo({
      title: 'Blog · Macro',
      description:
        'Writing from Macro: notes on product, engineering, management, and the software companies we learn from.',
      path: '/posts',
    });
  });

  return (
    <>
      <main class="posts-shell posts-index-shell posts-index-list">
        <header class="posts-index-hero">
          <h1>The Macro Blog</h1>
          <p class="posts-index-sub">
            Why we build Macro, how we use it, and the engineering behind it.
          </p>
        </header>

        <ul class="post-list" aria-label="All articles">
          <For each={posts}>
            {(post) => {
              const Graphic = postGraphics[post.meta.slug];
              const title = post.meta.titleLine2
                ? `${post.meta.title} ${post.meta.titleLine2}`
                : post.meta.title;
              const date = shortDate(post.meta.date);
              return (
                <li>
                  <A
                    href={`/posts/${post.meta.slug}`}
                    class="post-list-link"
                    title={title}
                  >
                    <span class="post-list-icon" aria-hidden="true">
                      {Graphic ? <Graphic height="24px" /> : null}
                    </span>
                    <h2 class="post-list-title">{title}</h2>
                    <Show when={date}>
                      <time class="post-list-date" dateTime={post.meta.date}>
                        {date}
                      </time>
                    </Show>
                    <ArrowRightIcon
                      class="post-list-arrow"
                      aria-hidden="true"
                    />
                  </A>
                </li>
              );
            }}
          </For>
        </ul>
      </main>
      <PostsPageTail ctaButtonName="blog_index_cta" />
    </>
  );
}
