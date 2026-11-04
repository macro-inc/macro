import { pendingDirectMessageId } from '@channel/primitives/pending-direct-messages';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { OpenWithSplitOptions } from '@components/app/split-layout/layoutManager';
import { useUserId } from '@core/context/user';
import { Telemetry } from '@macro-inc/observability';
import { existingDirectMessage } from '@queries/channel/get-or-create-dm';

type OpenDirectMessageOptions = Pick<
  OpenWithSplitOptions,
  'activate' | 'preferNewSplit' | 'referredFrom'
>;

/**
 * Opens the conversation with a person without creating it: their existing
 * DM, or a DM that doesn't exist yet, shown like an empty one, whose first
 * message creates it. Opening someone's profile never leaves an empty DM in
 * either person's list.
 */
export function useOpenDirectMessage() {
  const { openWithSplit } = useSplitLayout();
  const userId = useUserId();

  return (recipientId: string, options: OpenDirectMessageOptions = {}) =>
    Telemetry.span('channels.open_direct_message', async (span) => {
      const viewerId = userId();
      // There is no DM with yourself; the server refuses to make one.
      if (!viewerId || recipientId === viewerId) {
        span.setAttr('channels.open_direct_message.outcome', 'skipped');
        return;
      }

      const channelId = await span.span(
        'channels.find_direct_message',
        async (lookup) => {
          const existing = await existingDirectMessage(viewerId, recipientId);
          // A channel list that fails to load only costs the history view:
          // the first message still reaches an existing DM.
          if (existing.isErr()) {
            lookup.error(existing.error);
            return undefined;
          }
          lookup.setAttr(
            'channels.find_direct_message.found',
            existing.value !== undefined
          );
          return existing.value;
        }
      );

      if (channelId) {
        span.setAttr('channel.id', channelId);
        span.setAttr('channels.open_direct_message.outcome', 'existing');
        openWithSplit(
          { type: 'channel', id: channelId },
          { ...options, reopen: 'latest' }
        );
        return;
      }

      span.setAttr('channels.open_direct_message.outcome', 'pending');
      openWithSplit(
        { type: 'channel', id: pendingDirectMessageId(recipientId) },
        options
      );
    });
}
