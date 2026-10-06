/**
 * Comments kept in memory for the browser fixture: the `FigCommentStore`
 * contract the app fulfils with Macro comments. Its thread and composer are
 * plain stand-ins for the app's shared message thread and composer (which
 * need the message service), enough to drive the viewer's comment tool.
 * `arrive` adds a comment from someone else, as a live update would, and
 * `follow` opens a thread as a comment link does.
 */

import { createSignal, For, onMount } from 'solid-js';
import type {
  FigCommentComposerProps,
  FigCommentStore,
} from '../context/fig-comments';
import type {
  FigComment,
  FigCommentAnchor,
  FigCommentThread,
  FigPerson,
} from '../core/comments';

export const FIXTURE_PEOPLE: FigPerson[] = [
  { id: 'user-alex', name: 'Alex Morgan' },
  { id: 'user-blair', name: 'Blair Chen' },
  { id: 'user-casey', name: 'Casey Diaz' },
];

/** A text box: Enter posts, ⇧Enter starts a new line. */
function TextBox(props: {
  testId: string;
  placeholder: string;
  autofocus?: boolean;
  onPost: (text: string) => void;
}) {
  let input!: HTMLTextAreaElement;
  onMount(() => {
    if (props.autofocus) input.focus({ preventScroll: true });
  });
  const post = () => {
    const text = input.value.trim();
    if (!text) return;
    props.onPost(text);
    input.value = '';
  };
  return (
    <div class="flex flex-col gap-1.5">
      <textarea
        ref={input}
        rows={2}
        class="w-full resize-none rounded-md border border-edge-muted bg-input px-2 py-1.5 text-ink text-xs outline-none placeholder:text-ink-placeholder focus:border-accent"
        placeholder={props.placeholder}
        data-testid={props.testId}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            post();
          }
        }}
      />
      <button
        type="button"
        class="self-end rounded-md bg-accent px-2 py-1 text-accent-contrast text-xs"
        data-testid={`${props.testId}-post`}
        onClick={post}
      >
        Post
      </button>
    </div>
  );
}

export function createMemoryComments(me: FigPerson = FIXTURE_PEOPLE[0]) {
  const [threads, setThreads] = createSignal<FigCommentThread[]>([]);
  const [seen, setSeen] = createSignal<Record<string, number>>({});
  const [linked, setLinked] = createSignal<{ threadId: string | null }>();
  let next = 0;
  const id = () => `c${++next}`;
  // Strictly increasing, so a comment posted right after reading is newer.
  let clock = 0;
  const now = () => {
    clock = Math.max(clock + 1, Date.now());
    return clock;
  };

  const add = (threadId: string, comment: FigComment) =>
    setThreads((list) =>
      list.map((t) =>
        t.id === threadId
          ? {
              ...t,
              comments: [...t.comments, comment],
              replyCount: t.replyCount + 1,
            }
          : t
      )
    );
  const start = (anchor: FigCommentAnchor, comment: FigComment) =>
    setThreads((list) => [
      ...list,
      {
        id: comment.id,
        anchor,
        resolved: false,
        comments: [comment],
        replyCount: 0,
      },
    ]);
  const write = (author: FigPerson, text: string): FigComment => ({
    id: id(),
    author,
    text,
    createdAt: now(),
  });

  const markSeen = (threadId: string) =>
    setSeen((s) => ({ ...s, [threadId]: now() }));

  const store: FigCommentStore = {
    threads,
    me: () => me,
    canComment: () => true,
    seenAt: (threadId) => seen()[threadId],
    markSeen,
    async setResolved(threadId, resolved) {
      setThreads((list) =>
        list.map((t) => (t.id === threadId ? { ...t, resolved } : t))
      );
    },
    Thread: (props) => {
      const thread = () => threads().find((t) => t.id === props.threadId);
      return (
        <div class="flex flex-col gap-3">
          <For each={thread()?.comments}>
            {(c) => (
              <div class="text-xs" data-testid="fig-comment-item">
                <span class="font-medium">{c.author.name}</span> {c.text}
              </div>
            )}
          </For>
          <TextBox
            testId="fig-comment-reply"
            placeholder="Reply"
            onPost={(text) => {
              add(props.threadId, write(me, text));
              markSeen(props.threadId);
            }}
          />
        </div>
      );
    },
    Composer: (props: FigCommentComposerProps) => (
      <TextBox
        testId="fig-comment-input"
        placeholder="Add a comment"
        autofocus
        onPost={(text) => {
          const comment = write(me, text);
          start(props.anchor, comment);
          markSeen(comment.id);
          props.onPosted(comment.id);
        }}
      />
    ),
    linked,
  };

  /** Someone else comments: a reply to `threadId`, or a new thread. */
  const arrive = (
    author: FigPerson,
    text: string,
    target: { threadId: string } | { anchor: FigCommentAnchor }
  ) => {
    const comment = write(author, text);
    if ('threadId' in target) add(target.threadId, comment);
    else start(target.anchor, comment);
    return comment.id;
  };

  /** Follows a link to a thread, as opening a copied comment link does. */
  const follow = (threadId: string) => setLinked({ threadId });

  return { store, arrive, follow };
}
