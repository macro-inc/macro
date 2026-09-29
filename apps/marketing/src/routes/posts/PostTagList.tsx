import { A } from '@solidjs/router';
import { For, Show } from 'solid-js';
import { formatTagLabel } from './registry';

export function PostTagList(props: {
  tags: string[];
  /** Adds top margin for under-title placement */
  variant?: 'header' | 'inline';
  /** Default true: tags link to `/posts?tag=…` */
  link?: boolean;
}) {
  const link = () => props.link !== false;
  return (
    <Show when={props.tags.length > 0}>
      <ul
        class={`posts-tags${props.variant === 'header' ? ' posts-tags--aside' : ''}`}
        aria-label="Post tags"
      >
        <For each={props.tags}>
          {(tag) => (
            <li>
              {link() ? (
                <A
                  class="post-tag"
                  href={`/posts?tag=${encodeURIComponent(tag)}`}
                >
                  {formatTagLabel(tag)}
                </A>
              ) : (
                <span class="post-tag post-tag--inactive">
                  {formatTagLabel(tag)}
                </span>
              )}
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}
