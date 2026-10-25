import { Telemetry } from '@macro-inc/observability';
import { notificationTargetSpan } from '@notifications/notification-open-trace';
import { queryClient } from '@queries/client';
import { threadRepliesQueryOptions } from '@queries/messages/thread-replies';
import { messageTimelineQueryOptions } from '@queries/messages/timeline';

/** Warm the exact message window while the host resolves channel metadata. */
export async function prefetchChannelTarget(
  channelId: string,
  target: { messageId: string; threadId?: string }
): Promise<void> {
  // Bare links first need the surface's cancellable root/reply resolution.
  // Push destinations already identify the root, including roots themselves.
  const threadId = target.threadId;
  if (!threadId) return;
  const trace =
    notificationTargetSpan(channelId, target.messageId) ?? Telemetry;
  await trace.span('channel.target.prefetch', async (span) => {
    span.setAttr('channel.id', channelId);
    span.setAttr('message.id', target.messageId);
    const parent = { type: 'channel' as const, id: channelId };
    span.setAttr('thread.id', threadId);
    await Promise.all([
      queryClient.prefetchInfiniteQuery(
        messageTimelineQueryOptions(parent, threadId)
      ),
      ...(threadId !== target.messageId
        ? [
            queryClient.prefetchQuery(
              threadRepliesQueryOptions(parent, threadId)
            ),
          ]
        : []),
    ]);
    // TanStack prefetch owns error state; the mounted queries present failures.
    span.setAttr('channel.target.outcome', 'prefetch_settled');
  });
}
