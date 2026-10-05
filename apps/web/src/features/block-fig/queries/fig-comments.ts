/**
 * A design's comments as document discussions (`/dss/messages/document/<id>`),
 * the store markdown, PDF, and spreadsheet comments share: a thread is a
 * root message with replies, resolved on the thread, and mentions notify
 * through the inbox. A pinned thread's anchor is
 * `{ type: 'fig', pageId, nodeId, x, y }`, the `fig` variant of the
 * storage service's thread anchors; it accepts one only on a design.
 * Whole-document discussions show unpinned.
 */

import { queryClient } from '@queries/client';
import { useContacts } from '@queries/contacts/contacts';
import {
  useMessageActions,
  useMessageRootsQuery,
} from '@queries/messages/document-messages';
import { threadRepliesQueryOptions } from '@queries/messages/thread-replies';
import type { ThreadAnchor } from '@service-storage/generated/schemas/threadAnchor';
import type {
  Message,
  MessageListItem,
  PostMessage,
} from '@service-storage/messages';
import { createMemo, createSignal } from 'solid-js';
import type { FigCommentStore } from '../context/fig-comments';
import type {
  FigComment,
  FigCommentAnchor,
  FigCommentThread,
  FigPerson,
} from '../core/comments';

const MENTION = /<m-user-mention>(.*?)<\/m-user-mention>/g;

/** The pin a thread carries, or none for any other kind of anchor. */
function figAnchor(
  anchor: ThreadAnchor | null | undefined
): FigCommentAnchor | null {
  if (anchor?.type !== 'fig') return null;
  return {
    pageId: anchor.pageId,
    nodeId: anchor.nodeId ?? null,
    x: anchor.x,
    y: anchor.y,
  };
}

/** Macro Markdown with user mentions → `@Name` text and the people. */
export function fromContent(
  content: string,
  name: (userId: string) => string
): { text: string; mentions: FigPerson[] } {
  const mentions: FigPerson[] = [];
  const text = content.replace(MENTION, (_, json: string) => {
    try {
      const { userId } = JSON.parse(json) as { userId?: string };
      if (!userId) return '';
      const person = { id: userId, name: name(userId) };
      mentions.push(person);
      return `@${person.name}`;
    } catch {
      return '';
    }
  });
  return { text, mentions };
}

/** `@Name` text → Macro Markdown with user mentions, and their references. */
export function toContent(
  text: string,
  mentions: readonly FigPerson[],
  email: (userId: string) => string
): Pick<PostMessage, 'content' | 'mentions'> {
  let content = text;
  for (const m of mentions)
    content = content
      .split(`@${m.name}`)
      .join(
        `<m-user-mention>${JSON.stringify({ userId: m.id, email: email(m.id) })}</m-user-mention>`
      );
  return {
    content,
    mentions: mentions.map((m) => ({ entity_type: 'user', entity_id: m.id })),
  };
}

const seenKey = (documentId: string) => `fig-comments-seen:${documentId}`;

function readSeen(documentId: string): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(seenKey(documentId)) ?? '{}');
  } catch {
    return {};
  }
}

export function useFigComments(options: {
  documentId: string;
  userId: () => string | undefined;
  canComment: () => boolean;
  displayName: (userId: string) => string;
  email: (userId: string) => string;
}): FigCommentStore {
  const parent = () => ({
    type: 'document' as const,
    id: options.documentId,
  });
  const roots = useMessageRootsQuery(parent);
  const actions = useMessageActions(parent);
  const contacts = useContacts();
  const [replies, setReplies] = createSignal<Record<string, Message[]>>({});
  const [seen, setSeen] = createSignal(readSeen(options.documentId));

  const comment = (m: Message): FigComment => {
    const { text, mentions } = fromContent(m.content, options.displayName);
    return {
      id: m.id,
      author: { id: m.sender_id, name: options.displayName(m.sender_id) },
      text,
      mentions,
      createdAt: Date.parse(m.created_at),
    };
  };

  const thread = (item: MessageListItem): FigCommentThread => {
    const full = replies()[item.id] ?? item.thread.preview;
    return {
      id: item.id,
      anchor: figAnchor(item.state.anchor),
      resolved: item.state.resolved,
      comments: [item, ...full].filter((m) => !m.deleted_at).map(comment),
    };
  };

  const threads = createMemo(() => {
    const items = roots.isSuccess ? roots.data : [];
    return items
      .filter(
        (i) =>
          !i.state.deleted_at && (!i.state.anchor || figAnchor(i.state.anchor))
      )
      .map(thread);
  });

  const post = (message: PostMessage) => actions.post(message);
  /** A thread's every reply (the list holds only the first few). */
  const load = (threadId: string) => {
    void queryClient
      .fetchQuery(threadRepliesQueryOptions(parent(), threadId))
      .then((t) => setReplies((r) => ({ ...r, [threadId]: t.replies })))
      .catch(() => undefined);
  };

  return {
    threads,
    me: () => {
      const id = options.userId();
      return id ? { id, name: options.displayName(id) } : undefined;
    },
    canComment: options.canComment,
    seenAt: (id) => seen()[id],
    markSeen: (id) => {
      const next = { ...seen(), [id]: Date.now() };
      setSeen(next);
      try {
        localStorage.setItem(seenKey(options.documentId), JSON.stringify(next));
      } catch {
        // Unread state is a convenience; it resets without storage.
      }
    },
    async create(anchor, text, mentions) {
      const created = await post({
        ...toContent(text, mentions, options.email),
        anchor: { type: 'fig', ...anchor },
      });
      return created.id;
    },
    async reply(threadId, text, mentions) {
      await post({
        ...toContent(text, mentions, options.email),
        thread_id: threadId,
      });
      load(threadId);
    },
    async setResolved(threadId, resolved) {
      await actions.resolve(threadId, resolved);
    },
    async deleteThread(threadId) {
      await actions.deleteThread(threadId);
    },
    load,
    people: (query) => {
      const q = query.toLowerCase();
      const me = options.userId();
      return contacts()
        .filter(
          (u) =>
            u.id !== me &&
            (u.name.toLowerCase().includes(q) ||
              u.email.toLowerCase().includes(q))
        )
        .map((u) => ({ id: u.id, name: u.name || u.email }));
    },
  };
}
