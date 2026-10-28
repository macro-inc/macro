/**
 * Review threads under diff lines, the way a pull request host shows them:
 * `createDiffComments` places the threads and holds the draft, and the
 * `CommentThread` parts draw each one. Threads live in memory here.
 */

import { createSignal, For, Show } from 'solid-js';
import { CommentThread } from '../comments/CommentThread';
import { createDiffComments } from '../comments/create-diff-comments';
import { DiffView } from '../DiffView';
import type { LineRange } from '../model/lines';
import { SAMPLE_FILES, SAMPLE_PATCH } from './fixtures';

type ThreadComment = { id: number; author: string; text: string; at: string };
type Thread = { id: number; range: LineRange; comments: ThreadComment[] };

const UNREAD = 'apps/web/src/features/block-agent/state/unread.ts';
const SERVICE = 'crates/macro_agent_sessions/src/service.rs';

const SEED: Thread[] = [
  {
    id: 1,
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
    id: 2,
    range: {
      path: SERVICE,
      side: 'additions',
      startSide: 'deletions',
      lineNumber: 87,
      endLineNumber: 91,
    },
    comments: [
      {
        id: 3,
        author: 'Sam Ortiz',
        text: 'Mark read inside the same transaction, so a failed commit leaves both unset.',
        at: '3h',
      },
    ],
  },
];

/** Pierre's rows keep the context background unless the host clears it. */
const THREAD_ROW_CSS = `
[data-line-annotation], [data-gutter-buffer="annotation"] {
  --diffs-annotation-bg: transparent;
}`;

export function CommentsDemo() {
  const [threads, setThreads] = createSignal<Thread[]>(SEED);
  let nextId = 100;
  const post = (range: LineRange, text: string) => {
    const comment = {
      id: nextId++,
      author: 'You',
      text: text.trim(),
      at: 'now',
    };
    setThreads((list) => {
      const thread = list.find(
        (item) =>
          item.range.path === range.path &&
          item.range.side === range.side &&
          item.range.endLineNumber === range.endLineNumber
      );
      return thread
        ? list.map((item) =>
            item === thread
              ? { ...item, comments: [...item.comments, comment] }
              : item
          )
        : [...list, { id: nextId++, range, comments: [comment] }];
    });
  };

  const comments = createDiffComments({
    items: threads,
    rangeOf: (thread) => thread.range,
    render: (spot) => (
      <CommentThread.Root>
        <For each={spot.items}>
          {(thread) => (
            <For each={thread.comments}>
              {(comment) => (
                <CommentThread.Comment
                  author={comment.author}
                  time={comment.at}
                >
                  {comment.text}
                </CommentThread.Comment>
              )}
            </For>
          )}
        </For>
        <Show
          when={spot.draft}
          fallback={
            <Show when={spot.items[0]}>
              {(thread) => (
                <CommentThread.Reply
                  onClick={() => comments.startDraft(thread().range)}
                />
              )}
            </Show>
          }
        >
          {(draft) => (
            <CommentThread.Composer
              value={draft().text}
              onInput={comments.editDraft}
              onCancel={comments.cancelDraft}
              onSubmit={() => {
                post(draft().range, draft().text);
                comments.cancelDraft();
              }}
              submitLabel={spot.items.length > 0 ? 'Reply' : 'Comment'}
              placeholder={spot.items.length > 0 ? 'Reply' : 'Leave a comment'}
            />
          )}
        </Show>
      </CommentThread.Root>
    ),
  });

  return (
    <div class="flex h-[560px] min-h-0 flex-col overflow-hidden rounded-lg border border-edge bg-panel">
      <DiffView.Root
        files={SAMPLE_FILES.slice(1, 3)}
        patch={SAMPLE_PATCH}
        diffStyle="unified"
      >
        <DiffView.Stack
          annotations={comments.annotations}
          renderAnnotation={comments.renderAnnotation}
          selection={comments.selection}
          onSelectLines={comments.onSelectLines}
          unsafeCSS={THREAD_ROW_CSS}
        />
      </DiffView.Root>
    </div>
  );
}
