import type { ThreadQueryData, ThreadQueryResult } from '@queries/email/thread';
import type { ApiThread } from '@service-email/generated/schemas';
import { type Accessor, createMemo } from 'solid-js';
import type { EmailThreadSource } from '../context/email-thread-dependencies';
import type { EmailThread } from '../core/email-thread';

/** Decoding is the only entry for transport values into thread state. */
export function decodeThread(thread: ApiThread): EmailThread {
  return {
    ...thread,
    messages: thread.messages.map((message) => ({
      ...message,
      to: message.to.map((contact) => ({ ...contact })),
      cc: message.cc.map((contact) => ({ ...contact })),
      bcc: message.bcc.map((contact) => ({ ...contact })),
      from: message.from ? { ...message.from } : message.from,
      labels: message.labels.map((label) => ({ ...label })),
      attachments: message.attachments.map((attachment) => ({ ...attachment })),
      attachments_draft: message.attachments_draft.map((attachment) => ({
        ...attachment,
      })),
      attachments_forwarded: message.attachments_forwarded.map(
        (attachment) => ({ ...attachment })
      ),
    })),
  };
}

export function createEmailThreadSource(
  threadId: Accessor<string>,
  query: ThreadQueryResult<ThreadQueryData>
): EmailThreadSource {
  // Status guards prevent a pending Solid resource from suspending its owner.
  const thread = createMemo(() => {
    if (!query.isSuccess && !query.isError) return undefined;
    const data = query.data?.thread;
    return data?.db_id === threadId() ? decodeThread(data) : undefined;
  });
  return {
    id: threadId,
    thread,
    isError: () => query.isError,
    isLoading: () => query.isLoading,
    isFetching: () => query.isFetching,
    isFetchingOlder: () => query.isFetchingNextPage,
    hasMore: () => query.hasNextPage,
    fetchOlder: async () => {
      await query.fetchNextPage();
    },
    refresh: async () => {
      await query.refetch();
    },
  };
}
