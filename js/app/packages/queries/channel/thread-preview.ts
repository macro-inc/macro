import type { ApiThreadReply } from '@service-comms/client';
import type { ApiCountedReaction } from '@service-storage/generated/schemas';

type ThreadPreviewState = {
  preview: ApiThreadReply[];
  reply_count: number;
  latest_reply_at?: string | null;
};

type ThreadPreviewReplySnapshot = {
  previewIndex: number;
  reply: ApiThreadReply;
};

export function insertReplyIntoThreadPreview(
  thread: ThreadPreviewState,
  reply: ApiThreadReply
): ThreadPreviewState {
  if (thread.preview.some((previewReply) => previewReply.id === reply.id)) {
    return thread;
  }

  return {
    ...thread,
    latest_reply_at: reply.created_at,
    reply_count: thread.reply_count + 1,
    preview: [...thread.preview, reply],
  };
}

export function removeReplyFromThreadPreview(
  thread: ThreadPreviewState,
  replyId: string
): ThreadPreviewState {
  const nextPreview = thread.preview.filter((reply) => reply.id !== replyId);
  const didRemovePreview = nextPreview.length !== thread.preview.length;
  if (!didRemovePreview && thread.reply_count === 0) {
    return thread;
  }

  return {
    ...thread,
    latest_reply_at: didRemovePreview
      ? (nextPreview.at(-1)?.created_at ?? null)
      : thread.latest_reply_at,
    reply_count: Math.max(thread.reply_count - 1, 0),
    preview: nextPreview,
  };
}

export function replaceReplyIdInThreadPreview(
  thread: ThreadPreviewState,
  optimisticId: string,
  realId: string
): ThreadPreviewState {
  let didChange = false;
  const preview = thread.preview.map((reply) => {
    if (reply.id !== optimisticId) return reply;
    didChange = true;
    return { ...reply, id: realId };
  });

  return didChange ? { ...thread, preview } : thread;
}

export function replaceReplyReactionsInThreadPreview(
  thread: ThreadPreviewState,
  replyId: string,
  reactions: ApiCountedReaction[]
): ThreadPreviewState {
  let didChange = false;
  const preview = thread.preview.map((reply) => {
    if (reply.id !== replyId) return reply;
    didChange = true;
    return { ...reply, reactions };
  });

  return didChange ? { ...thread, preview } : thread;
}

export function captureThreadPreviewReplySnapshot(
  thread: ThreadPreviewState,
  replyId: string
): ThreadPreviewReplySnapshot | undefined {
  const previewIndex = thread.preview.findIndex(
    (reply) => reply.id === replyId
  );
  if (previewIndex === -1) return undefined;

  return {
    previewIndex,
    reply: thread.preview[previewIndex],
  };
}

export function restoreReplyToThreadPreview(
  thread: ThreadPreviewState,
  snapshot?: ThreadPreviewReplySnapshot,
  replyCreatedAt?: string
): ThreadPreviewState {
  if (
    snapshot &&
    thread.preview.some((reply) => reply.id === snapshot.reply.id)
  ) {
    return thread;
  }

  const preview = [...thread.preview];
  if (snapshot) {
    preview.splice(snapshot.previewIndex, 0, snapshot.reply);
  }

  return {
    ...thread,
    preview,
    reply_count: thread.reply_count + 1,
    latest_reply_at:
      [thread.latest_reply_at, replyCreatedAt]
        .filter((value): value is string => !!value)
        .sort()
        .at(-1) ??
      preview.at(-1)?.created_at ??
      null,
  };
}
