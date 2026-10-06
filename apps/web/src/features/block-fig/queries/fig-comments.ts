/**
 * A design's comments as Macro comments: document discussions
 * (`/dss/messages/document/<id>`), the store markdown, PDF, and spreadsheet
 * comments share, written with the shared composer's payload. A pinned
 * thread's root carries `{ type: 'fig', pageId, nodeId, x, y }`, the `fig`
 * variant of the storage service's thread anchors (accepted only on a
 * design); the design's other roots are its discussion.
 */

import type { InputSnapshot } from '@channel/Input';
import { buildPostMessageSendPayload } from '@channel/Input/message-payload';
import { markdownToPlainText } from '@macro-inc/lexical-core';
import { useMessageRootsQuery } from '@queries/messages/document-messages';
import {
  newMessageId,
  usePatchThreadMutation,
  useSendMessageMutation,
} from '@queries/messages/mutations';
import type { ThreadAnchor } from '@service-storage/generated/schemas/threadAnchor';
import type { Message, MessageListItem } from '@service-storage/messages';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import type {
  FigComment,
  FigCommentAnchor,
  FigCommentThread,
} from '../core/comments';

/** The pin a thread carries, or none for any other kind of anchor. */
export function figAnchor(
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

/**
 * The viewer's summary of a pinned root: its first comment and latest
 * replies as plain text. `undefined` for a root pinned elsewhere or
 * nowhere, or deleted with nothing left to read.
 */
export function figThread(
  item: MessageListItem,
  name: (userId: string) => string
): FigCommentThread | undefined {
  const anchor = figAnchor(item.state.anchor);
  if (
    !anchor ||
    item.state.deleted_at ||
    (item.deleted_at && item.thread.reply_count === 0)
  )
    return undefined;
  const comment = (m: Message): FigComment => ({
    id: m.id,
    author: { id: m.sender_id, name: name(m.sender_id) },
    text: m.deleted_at
      ? ''
      : markdownToPlainText(m.content).trim().replace(/\s+/g, ' '),
    createdAt: Date.parse(m.created_at),
  });
  return {
    id: item.id,
    anchor,
    resolved: item.state.resolved,
    comments: [item, ...item.thread.preview.filter((m) => !m.deleted_at)].map(
      comment
    ),
    replyCount: item.thread.reply_count,
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

export function useFigCommentSource(options: {
  documentId: string;
  userId: Accessor<string | undefined>;
  displayName: (userId: string) => string;
}) {
  const parent = () => ({
    type: 'document' as const,
    id: options.documentId,
  });
  const query = useMessageRootsQuery(parent);
  const send = useSendMessageMutation();
  const patchThread = usePatchThreadMutation();
  const [seen, setSeen] = createSignal(readSeen(options.documentId));

  const roots = () => (query.isSuccess ? query.data : []);
  const threads = createMemo(() =>
    roots().flatMap((item) => figThread(item, options.displayName) ?? [])
  );

  return {
    parent,
    /** Whether the roots have loaded (a link resolves against them). */
    loaded: () => query.isSuccess,
    roots,
    root: (id: string) => roots().find((item) => item.id === id),
    threads,
    seenAt: (id: string): number | undefined => seen()[id],
    markSeen: (id: string) => {
      const next = { ...seen(), [id]: Date.now() };
      setSeen(next);
      try {
        localStorage.setItem(seenKey(options.documentId), JSON.stringify(next));
      } catch {
        // Unread state is a convenience; it resets without storage.
      }
    },
    setResolved: async (rootId: string, resolved: boolean) => {
      await patchThread.mutateAsync({
        parent: parent(),
        rootId,
        patch: { resolved },
      });
    },
    /** Starts a thread pinned at `anchor`; resolves to its id. */
    post: async (anchor: FigCommentAnchor, snapshot: InputSnapshot) => {
      const senderId = options.userId();
      if (!senderId) throw new Error('Sign in to comment');
      const payload = buildPostMessageSendPayload({ snapshot });
      const message = await send.mutateAsync({
        parent: parent(),
        senderId,
        optimisticId: newMessageId(),
        ...payload,
        message: { ...payload.message, anchor: { type: 'fig', ...anchor } },
      });
      return message.id;
    },
  };
}
