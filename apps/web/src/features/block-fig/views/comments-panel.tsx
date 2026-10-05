/**
 * The comments sidebar (the right panel while the comment tool is on):
 * every thread on the design, open or resolved, newest activity first,
 * with unread dots; a thread opens beside its pin, on its page.
 */

import { For, Show } from 'solid-js';
import { CommentAvatar, CommentText } from '../components/comment-thread';
import { type CommentFilter, relativeTime } from '../core/comments';
import type { FigComments } from '../primitives/create-fig-comments';

const FILTERS: { value: CommentFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All' },
];

export function CommentsPanel(props: {
  comments: FigComments;
  /** Page names by id, for threads on other pages. */
  pageName: (id: string) => string | undefined;
  currentPage: string | undefined;
}) {
  const c = props.comments;
  const now = Date.now();
  return (
    <div
      class="flex size-full min-h-0 flex-col text-ink text-xs"
      data-testid="fig-comments-panel"
    >
      <div class="flex h-9 shrink-0 items-center gap-1 border-edge-muted border-b px-2">
        <span class="px-1 font-medium">Comments</span>
        <div class="ml-auto flex items-center gap-0.5">
          <For each={FILTERS}>
            {(f) => (
              <button
                type="button"
                class="rounded-md px-1.5 py-1"
                classList={{
                  'bg-hover text-ink': c.filter() === f.value,
                  'text-ink-muted': c.filter() !== f.value,
                }}
                aria-pressed={c.filter() === f.value}
                data-testid={`fig-comments-filter-${f.value}`}
                onClick={() => c.setFilter(f.value)}
              >
                {f.label}
              </button>
            )}
          </For>
        </div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={c.listed().length > 0}
          fallback={
            <p
              class="px-3 py-4 text-ink-muted"
              data-testid="fig-comments-empty"
            >
              {c.filter() === 'resolved'
                ? 'No resolved comments.'
                : 'No comments yet. Click the canvas to add one.'}
            </p>
          }
        >
          <For each={c.listed()}>
            {(thread) => {
              const first = () => thread.comments[0];
              const replies = () => thread.comments.length - 1;
              const unread = () => c.isUnread(thread);
              const page = () =>
                thread.anchor && thread.anchor.pageId !== props.currentPage
                  ? props.pageName(thread.anchor.pageId)
                  : undefined;
              return (
                <button
                  type="button"
                  class="flex w-full gap-2 border-edge-muted border-b px-3 py-2.5 text-left hover:bg-hover"
                  classList={{ 'bg-hover': c.openThread() === thread.id }}
                  data-testid="fig-comment-row"
                  data-thread={thread.id}
                  data-unread={unread() ? 'true' : 'false'}
                  onClick={() => void c.reveal(thread)}
                >
                  <Show when={first()}>
                    {(f) => <CommentAvatar person={f().author} />}
                  </Show>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline gap-1.5">
                      <span class="truncate font-medium">
                        {first()?.author.name}
                      </span>
                      <span class="shrink-0 text-[11px] text-ink-muted">
                        {relativeTime(
                          thread.comments.at(-1)?.createdAt ?? 0,
                          now
                        )}
                      </span>
                      <Show when={unread()}>
                        <span
                          class="ml-auto size-2 shrink-0 rounded-full bg-accent"
                          aria-label="Unread"
                        />
                      </Show>
                    </div>
                    <Show when={first()}>
                      {(f) => (
                        <div class="line-clamp-3">
                          <CommentText comment={f()} />
                        </div>
                      )}
                    </Show>
                    <div class="mt-1 flex gap-2 text-[11px] text-ink-muted">
                      <Show when={replies() > 0}>
                        <span>
                          {replies()} {replies() === 1 ? 'reply' : 'replies'}
                        </span>
                      </Show>
                      <Show when={thread.resolved}>
                        <span>Resolved</span>
                      </Show>
                      <Show when={page()}>{(p) => <span>{p()}</span>}</Show>
                    </div>
                  </div>
                </button>
              );
            }}
          </For>
        </Show>
      </div>
    </div>
  );
}
