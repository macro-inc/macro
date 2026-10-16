/**
 * The comment tool's searchable list of pinned threads, alongside the
 * canvas, with the design's discussion (comments pinned nowhere) below.
 */
import FunnelSimple from '@phosphor/funnel-simple.svg';
import MagnifyingGlass from '@phosphor/magnifying-glass.svg';
import X from '@phosphor/x.svg';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { EditorMenu } from '../components/editor-menu';
import {
  type CommentFilter,
  type FigPerson,
  initialsOf,
  relativeTime,
} from '../core/comments';
import type { FigComments } from '../primitives/create-fig-comments';

function Avatar(props: { person: FigPerson }) {
  return (
    <span
      class="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-bg font-medium text-[10px] text-accent"
      title={props.person.name}
    >
      {initialsOf(props.person.name)}
    </span>
  );
}

const FILTERS: { value: CommentFilter; label: string }[] = [
  { value: 'open', label: 'Open comments' },
  { value: 'resolved', label: 'Resolved comments' },
  { value: 'all', label: 'All comments' },
];

export function CommentsPanel(props: {
  comments: FigComments;
  pageName: (id: string) => string | undefined;
  headerActions?: JSX.Element;
  zoom?: JSX.Element;
}) {
  const c = props.comments;
  const now = Date.now();
  const [query, setQuery] = createSignal('');
  const threads = createMemo(() => {
    const search = query().trim().toLowerCase();
    return c
      .listed()
      .filter(
        (thread) =>
          !search ||
          thread.comments.some((comment) =>
            `${comment.author.name} ${comment.text}`
              .toLowerCase()
              .includes(search)
          )
      );
  });
  return (
    <div
      class="flex size-full min-h-0 flex-col text-ink text-xs"
      data-testid="fig-comments-panel"
    >
      <div class="flex h-12 shrink-0 items-center justify-end px-3">
        {props.headerActions}
      </div>
      <div class="flex h-10 shrink-0 items-center justify-between border-edge-frame border-b px-3">
        <h3 class="font-medium">Comments</h3>
        {props.zoom}
      </div>
      <div class="flex shrink-0 items-center gap-1 border-edge-frame border-b px-3 py-2">
        <label class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-inset px-2 py-1.5 focus-within:ring-1 focus-within:ring-accent">
          <MagnifyingGlass class="size-3.5 shrink-0 text-ink-muted" />
          <input
            type="search"
            aria-label="Search comments"
            placeholder="Search"
            data-testid="fig-comments-search"
            class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-placeholder"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
        </label>
        <Show when={query()}>
          <button
            type="button"
            aria-label="Clear comment search"
            class="flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-hover"
            onClick={() => setQuery('')}
          >
            <X class="size-3.5" />
          </button>
        </Show>
        <EditorMenu
          label="Filter comments"
          testId="fig-comments-filter"
          items={FILTERS.map((filter) => ({
            label: filter.label,
            checked: c.filter() === filter.value,
            testId: `fig-comments-filter-${filter.value}`,
            onSelect: () => c.setFilter(filter.value),
          }))}
        >
          <FunnelSimple class="size-4" />
        </EditorMenu>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto">
        <Show
          when={threads().length > 0}
          fallback={
            <p
              class="px-3 py-4 text-ink-muted"
              data-testid="fig-comments-empty"
            >
              {query()
                ? 'No matching comments.'
                : c.filter() === 'resolved'
                  ? 'No resolved comments.'
                  : c.store.canComment()
                    ? 'No comments on the canvas yet. Click it to add one.'
                    : 'No comments on the canvas yet.'}
            </p>
          }
        >
          <For each={threads()}>
            {(thread) => {
              const first = () => thread.comments[0];
              const replies = () => thread.replyCount;
              const people = () =>
                [
                  ...new Map(
                    thread.comments.map((comment) => [
                      comment.author.id,
                      comment.author,
                    ])
                  ).values(),
                ].slice(0, 4);
              const page = () => props.pageName(thread.anchor.pageId);
              return (
                <button
                  type="button"
                  class="flex w-full flex-col gap-1.5 px-4 py-4 text-left hover:bg-hover"
                  classList={{ 'bg-hover': c.openThread() === thread.id }}
                  data-testid="fig-comment-row"
                  data-thread={thread.id}
                  data-unread={c.isUnread(thread) ? 'true' : 'false'}
                  onClick={() => void c.reveal(thread)}
                >
                  <div class="mb-0.5 flex w-full items-center gap-1">
                    <For each={people()}>
                      {(person) => <Avatar person={person} />}
                    </For>
                    <Show when={c.isUnread(thread)}>
                      <span
                        class="ml-auto size-1.5 rounded-full bg-accent"
                        aria-label="Unread"
                      />
                    </Show>
                  </div>
                  <Show when={page()}>
                    {(name) => <span class="text-ink-muted">{name()}</span>}
                  </Show>
                  <div class="flex w-full min-w-0 items-baseline gap-1.5">
                    <span class="truncate font-medium">
                      {first()?.author.name}
                    </span>
                    <span class="shrink-0 text-[11px] text-ink-muted">
                      {relativeTime(
                        thread.comments.at(-1)?.createdAt ?? 0,
                        now
                      )}
                    </span>
                  </div>
                  <Show when={first()?.text}>
                    {(text) => (
                      <p class="line-clamp-3 whitespace-pre-wrap break-words text-ink">
                        {text()}
                      </p>
                    )}
                  </Show>
                  <div class="flex gap-2 text-[11px]">
                    <Show when={replies() > 0}>
                      <span class="text-accent">
                        {replies()} {replies() === 1 ? 'reply' : 'replies'}
                      </span>
                    </Show>
                    <Show when={thread.resolved}>
                      <span class="text-ink-muted">Resolved</span>
                    </Show>
                  </div>
                </button>
              );
            }}
          </For>
        </Show>
        <Show when={c.store.Discussion}>
          {(discussion) => (
            <div
              class="border-edge-frame border-t px-3 py-2"
              data-testid="fig-comments-discussion"
            >
              <Dynamic component={discussion()} />
            </div>
          )}
        </Show>
      </div>
    </div>
  );
}
