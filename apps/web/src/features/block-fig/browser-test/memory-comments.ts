/**
 * Comments kept in memory for the browser fixture: the `FigCommentStore`
 * contract the app fulfils with document discussions. `arrive` adds a
 * comment from someone else, as a live update would.
 */

import { createSignal } from 'solid-js';
import type { FigCommentStore } from '../context/fig-comments';
import type {
  FigCommentAnchor,
  FigCommentThread,
  FigPerson,
} from '../core/comments';

export const FIXTURE_PEOPLE: FigPerson[] = [
  { id: 'user-alex', name: 'Alex Morgan' },
  { id: 'user-blair', name: 'Blair Chen' },
  { id: 'user-casey', name: 'Casey Diaz' },
];

export function createMemoryComments(me: FigPerson = FIXTURE_PEOPLE[0]) {
  const [threads, setThreads] = createSignal<FigCommentThread[]>([]);
  const [seen, setSeen] = createSignal<Record<string, number>>({});
  const notified: { to: string; threadId: string }[] = [];
  let next = 0;
  const id = () => `c${++next}`;
  // Strictly increasing, so a comment posted right after reading is newer.
  let clock = 0;
  const now = () => {
    clock = Math.max(clock + 1, Date.now());
    return clock;
  };

  const store: FigCommentStore = {
    threads,
    me: () => me,
    canComment: () => true,
    seenAt: (threadId) => seen()[threadId],
    markSeen: (threadId) => setSeen((s) => ({ ...s, [threadId]: now() })),
    async create(anchor: FigCommentAnchor, text, mentions) {
      const commentId = id();
      setThreads((list) => [
        ...list,
        {
          id: commentId,
          anchor,
          resolved: false,
          comments: [
            { id: commentId, author: me, text, mentions, createdAt: now() },
          ],
        },
      ]);
      store.markSeen(commentId);
      for (const m of mentions)
        notified.push({ to: m.id, threadId: commentId });
      return commentId;
    },
    async reply(threadId, text, mentions) {
      setThreads((list) =>
        list.map((t) =>
          t.id === threadId
            ? {
                ...t,
                comments: [
                  ...t.comments,
                  { id: id(), author: me, text, mentions, createdAt: now() },
                ],
              }
            : t
        )
      );
      store.markSeen(threadId);
      for (const m of mentions) notified.push({ to: m.id, threadId });
    },
    async setResolved(threadId, resolved) {
      setThreads((list) =>
        list.map((t) => (t.id === threadId ? { ...t, resolved } : t))
      );
    },
    async deleteThread(threadId) {
      setThreads((list) => list.filter((t) => t.id !== threadId));
    },
    people: (query) =>
      FIXTURE_PEOPLE.filter(
        (p) =>
          p.id !== me.id && p.name.toLowerCase().includes(query.toLowerCase())
      ),
  };

  /** Someone else comments: a reply to `threadId`, or a new thread. */
  const arrive = (
    author: FigPerson,
    text: string,
    target: { threadId: string } | { anchor: FigCommentAnchor }
  ) => {
    const comment = {
      id: id(),
      author,
      text,
      mentions: [],
      createdAt: now(),
    };
    if ('threadId' in target)
      setThreads((list) =>
        list.map((t) =>
          t.id === target.threadId
            ? { ...t, comments: [...t.comments, comment] }
            : t
        )
      );
    else
      setThreads((list) => [
        ...list,
        {
          id: comment.id,
          anchor: target.anchor,
          resolved: false,
          comments: [comment],
        },
      ]);
    return comment.id;
  };

  return { store, arrive, notified: () => [...notified] };
}
