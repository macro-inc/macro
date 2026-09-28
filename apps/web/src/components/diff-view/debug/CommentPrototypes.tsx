/**
 * Two ways a host can show review comments on the diff view, over the same
 * in-memory threads: inline threads in Pierre's annotation rows, restyled
 * through `unsafeCSS`; and a margin column beside each file, placed by
 * measuring zero-height anchors Pierre keeps under each commented line.
 * Focusing a thread lights the lines it covers through the view's
 * `selection`.
 *
 * Draft text lives in the thread store, not in the editor, because Pierre
 * re-creates an annotation's element when rows before it change.
 */

import { Avatar, Button } from '@ui';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { DiffView } from '../DiffView';
import type { LineAnnotation, LineRange } from '../model/lines';
import { SAMPLE_FILES, SAMPLE_PATCH } from './fixtures';

type ThreadComment = { id: number; author: string; text: string; at: string };
type Thread = { range: LineRange; comments: ThreadComment[] };
type Draft = { range: LineRange; text: string };

const UNREAD = 'apps/web/src/features/block-agent/state/unread.ts';
const SERVICE = 'crates/macro_agent_sessions/src/service.rs';

const SEED: Thread[] = [
  {
    range: {
      path: UNREAD,
      side: 'additions',
      lineNumber: 8,
      endLineNumber: 13,
    },
    comments: [
      {
        id: 1,
        author: 'Maya Chen',
        text: 'Could this take the archive time instead of the whole session?',
        at: '2h',
      },
      {
        id: 2,
        author: 'Rahul',
        text: 'The sidebar only has the summary, so the session is what it can pass.',
        at: '1h',
      },
    ],
  },
  {
    range: {
      path: SERVICE,
      side: 'deletions',
      lineNumber: 87,
      endLineNumber: 88,
    },
    comments: [
      {
        id: 3,
        author: 'Sam Ortiz',
        text: 'This used to skip the read marker entirely.',
        at: '1d',
      },
    ],
  },
  {
    range: {
      path: SERVICE,
      side: 'additions',
      lineNumber: 91,
      endLineNumber: 91,
    },
    comments: [
      {
        id: 4,
        author: 'Maya Chen',
        text: 'Mark read inside the same transaction, so a failed commit leaves both unset.',
        at: '3h',
      },
    ],
  },
];

/** Threads hang under the last line of their range, one per side and line. */
const threadKey = (range: Pick<LineRange, 'side' | 'endLineNumber'>) =>
  `${range.side}:${range.endLineNumber}`;

function initials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function createThreadStore() {
  const [threads, setThreads] = createSignal<Thread[]>(SEED);
  const [draft, setDraft] = createSignal<Draft>();
  // The thread with focus wins over the range a new comment is being written on.
  const [focused, setFocused] = createSignal<LineRange>();
  let nextId = 100;

  const at = (range: LineRange | undefined, path: string, key: string) =>
    range?.path === path && threadKey(range) === key;

  return {
    annotations: (path: string): LineAnnotation[] => {
      const spots = new Map<string, LineAnnotation>();
      const ranges = threads()
        .map((thread) => thread.range)
        .concat(draft()?.range ?? []);
      for (const range of ranges) {
        if (range.path !== path) continue;
        const key = threadKey(range);
        spots.set(key, {
          key,
          side: range.side,
          lineNumber: range.endLineNumber,
        });
      }
      return [...spots.values()];
    },
    threadAt: (path: string, key: string) =>
      threads().find((thread) => at(thread.range, path, key)),
    draftAt: (path: string, key: string) => {
      const current = draft();
      return at(current?.range, path, key) ? current : undefined;
    },
    selection: () => focused() ?? draft()?.range,
    focus: setFocused,
    startDraft: (range: LineRange) => setDraft({ range, text: '' }),
    editDraft: (text: string) =>
      setDraft((current) => (current ? { ...current, text } : current)),
    cancelDraft: () => setDraft(undefined),
    submitDraft: () => {
      const current = draft();
      setDraft(undefined);
      if (!current || current.text.trim() === '') return;
      const comment = {
        id: nextId++,
        author: 'You',
        text: current.text.trim(),
        at: 'now',
      };
      const key = threadKey(current.range);
      setThreads((list) => {
        const existing = list.find(
          (thread) =>
            thread.range.path === current.range.path &&
            threadKey(thread.range) === key
        );
        return existing
          ? list.map((thread) =>
              thread === existing
                ? { ...thread, comments: [...thread.comments, comment] }
                : thread
            )
          : [...list, { range: current.range, comments: [comment] }];
      });
    },
  };
}

type ThreadStore = ReturnType<typeof createThreadStore>;

function CommentRow(props: { comment: ThreadComment }) {
  return (
    <div class="flex gap-2">
      <Avatar size="md">
        <Avatar.Fallback>{initials(props.comment.author)}</Avatar.Fallback>
      </Avatar>
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <div class="flex items-baseline gap-2">
          <span class="text-sm font-medium text-ink">
            {props.comment.author}
          </span>
          <span class="text-xs text-ink-subtle">{props.comment.at}</span>
        </div>
        <p class="text-sm whitespace-pre-wrap text-ink-muted">
          {props.comment.text}
        </p>
      </div>
    </div>
  );
}

function Composer(props: { store: ThreadStore; draft: Draft; reply: boolean }) {
  let textarea!: HTMLTextAreaElement;
  onMount(() => textarea.focus());
  return (
    <div class="flex flex-col gap-2">
      <textarea
        ref={textarea}
        class="min-h-16 w-full resize-y rounded-lg border border-edge bg-input px-2.5 py-2 text-sm text-ink outline-none placeholder:text-ink-placeholder focus:border-input-focus"
        placeholder={props.reply ? 'Reply' : 'Leave a comment'}
        aria-label="Comment"
        value={props.draft.text}
        onInput={(event) => props.store.editDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') props.store.cancelDraft();
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            props.store.submitDraft();
          }
        }}
      />
      <div class="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={props.store.cancelDraft}>
          Cancel
        </Button>
        <Button
          variant="cta"
          size="sm"
          disabled={props.draft.text.trim() === ''}
          onClick={props.store.submitDraft}
        >
          {props.reply ? 'Reply' : 'Comment'}
        </Button>
      </div>
    </div>
  );
}

/** A thread (or a new one being written) as one card. */
function ThreadCard(props: { store: ThreadStore; path: string; spot: string }) {
  const thread = () => props.store.threadAt(props.path, props.spot);
  const draft = () => props.store.draftAt(props.path, props.spot);
  const range = () => thread()?.range ?? draft()?.range;
  return (
    <div
      class="flex flex-col gap-3 rounded-xl border border-edge-muted bg-surface p-3 transition focus-within:border-edge"
      onFocusIn={() => props.store.focus(range())}
      onFocusOut={(event) => {
        const next = event.relatedTarget;
        if (!(next instanceof Node && event.currentTarget.contains(next))) {
          props.store.focus(undefined);
        }
      }}
    >
      <For each={thread()?.comments}>
        {(comment) => <CommentRow comment={comment} />}
      </For>
      <Show
        when={draft()}
        fallback={
          <Show when={thread()}>
            {(current) => (
              <Button
                variant="ghost"
                size="sm"
                class="self-start"
                onClick={() => props.store.startDraft(current().range)}
              >
                Reply
              </Button>
            )}
          </Show>
        }
      >
        {(current) => (
          <Composer
            store={props.store}
            draft={current()}
            reply={thread() !== undefined}
          />
        )}
      </Show>
    </div>
  );
}

function Frame(props: { children: JSX.Element }) {
  return (
    <div class="flex h-[560px] min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-panel">
      {props.children}
    </div>
  );
}

/** Pierre's rows keep the context background unless the host clears it. */
const INLINE_THREAD_CSS = `
[data-line-annotation], [data-gutter-buffer="annotation"] {
  --diffs-annotation-bg: transparent;
}`;

/** Threads under their lines, in Pierre's annotation rows. */
export function InlineThreadsDemo() {
  const store = createThreadStore();
  return (
    <Frame>
      <DiffView.Root
        files={SAMPLE_FILES.slice(1, 3)}
        patch={SAMPLE_PATCH}
        diffStyle="unified"
      >
        <DiffView.Stack
          annotations={(entry) => store.annotations(entry.file.path)}
          renderAnnotation={(entry, key) => (
            <div class="px-3 py-2 font-sans">
              <ThreadCard store={store} path={entry.file.path} spot={key} />
            </div>
          )}
          selection={store.selection}
          onSelectLines={store.startDraft}
          unsafeCSS={INLINE_THREAD_CSS}
        />
      </DiffView.Root>
    </Frame>
  );
}

/** The commented line's height, from `PIERRE_STYLE_VARIABLES`. */
const LINE_HEIGHT_PX = 18;
const CARD_GAP_PX = 8;

/**
 * One file's margin: each thread card sits beside its line, measured from
 * the anchor Pierre placed under that line, and pushed down past the card
 * above it when two would overlap.
 */
function MarginColumn(props: { store: ThreadStore; path: string }) {
  let column!: HTMLDivElement;
  const cards = new Map<string, HTMLElement>();
  const [layout, setLayout] = createSignal<{
    tops: Record<string, number>;
    height: number;
  }>({ tops: {}, height: 0 });
  const keys = () => props.store.annotations(props.path).map(({ key }) => key);

  const measure = () => {
    const card = column.closest('[data-path]');
    if (!card) return;
    const origin = column.getBoundingClientRect().top;
    const anchors = [
      ...card.querySelectorAll<HTMLElement>('[data-comment-anchor]'),
    ]
      .map((anchor) => ({
        key: anchor.dataset.commentAnchor ?? '',
        top: anchor.getBoundingClientRect().top - origin - LINE_HEIGHT_PX,
      }))
      .sort((a, b) => a.top - b.top);
    const tops: Record<string, number> = {};
    let bottom = 0;
    for (const { key, top } of anchors) {
      const y = Math.max(top, bottom);
      tops[key] = y;
      bottom = y + (cards.get(key)?.offsetHeight ?? 0) + CARD_GAP_PX;
    }
    const next = { tops, height: bottom };
    if (JSON.stringify(next) !== JSON.stringify(layout())) setLayout(next);
  };

  // The diff grows as Pierre renders and wraps, and cards grow while a
  // reply is written; either can move the cards below.
  const observer = new ResizeObserver(() => requestAnimationFrame(measure));
  onCleanup(() => observer.disconnect());
  onMount(() => {
    if (column.parentElement) observer.observe(column.parentElement);
  });
  createEffect(on(keys, () => requestAnimationFrame(measure)));

  return (
    <div
      ref={column}
      class="relative w-80 shrink-0 border-l border-edge-muted bg-inset"
      style={{ 'min-height': `${layout().height}px` }}
    >
      <For each={keys()}>
        {(key) => (
          <div
            ref={(element) => {
              cards.set(key, element);
              observer.observe(element);
              onCleanup(() => {
                cards.delete(key);
                observer.unobserve(element);
              });
            }}
            class="absolute inset-x-2 transition-[top] duration-150 motion-reduce:transition-none"
            style={{
              top: `${layout().tops[key] ?? 0}px`,
              visibility:
                layout().tops[key] === undefined ? 'hidden' : 'visible',
            }}
          >
            <ThreadCard store={props.store} path={props.path} spot={key} />
          </div>
        )}
      </For>
    </div>
  );
}

/** Threads in a margin beside each file, lined up with their lines. */
export function MarginCommentsDemo() {
  const store = createThreadStore();
  return (
    <Frame>
      <DiffView.Root
        files={SAMPLE_FILES.slice(1, 3)}
        patch={SAMPLE_PATCH}
        diffStyle="unified"
      >
        <DiffView.Stack
          annotations={(entry) => store.annotations(entry.file.path)}
          renderAnnotation={(_entry, key) => (
            <div data-comment-anchor={key} class="h-0" />
          )}
          selection={store.selection}
          onSelectLines={store.startDraft}
          aside={(entry) => (
            <MarginColumn store={store} path={entry.file.path} />
          )}
        />
      </DiffView.Root>
    </Frame>
  );
}
