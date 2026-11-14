import { pendingDirectMessageId } from '@channel/primitives/pending-direct-messages';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type {
  OpenWithSplitOptions,
  SplitContent,
} from '@components/app/split-layout/layoutManager';
import { useUserId } from '@core/context/user';
import { Telemetry, type TraceContext } from '@macro-inc/observability';
import { existingDirectMessage } from '@queries/channel/get-or-create-dm';

type OpenDirectMessageOptions = Pick<
  OpenWithSplitOptions,
  'activate' | 'preferNewSplit' | 'referredFrom'
> & {
  /** The caller's span, kept across the lookup's await. */
  parentSpan?: TraceContext;
};

/**
 * Shows the DM, given the channel to open and whether it already exists (an
 * existing one reopens where it was left).
 */
export type OpenDirectMessageChannel = (
  content: SplitContent,
  existing: boolean
) => void;

/**
 * Opens the conversation between `viewerId` and `recipientId` without
 * creating it: their existing DM, or a DM that doesn't exist yet, shown like
 * an empty one, whose first message creates it. Opening someone's profile
 * never leaves an empty DM in either person's list. For code outside
 * components (a notification's action); components use
 * `useOpenDirectMessage`.
 */
export function openDirectMessage(
  viewerId: string | undefined,
  recipientId: string,
  open: OpenDirectMessageChannel
) {
  return Telemetry.span('channels.open_direct_message', async (span) => {
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
      open({ type: 'channel', id: channelId }, true);
      return;
    }

    span.setAttr('channels.open_direct_message.outcome', 'pending');
    open({ type: 'channel', id: pendingDirectMessageId(recipientId) }, false);
  });
}

/** Opens the conversation with a person; see {@link openDirectMessage}. */
export function useOpenDirectMessage() {
  const { openWithSplit } = useSplitLayout();
  const userId = useUserId();

  return (
    recipientId: string,
    { parentSpan, ...options }: OpenDirectMessageOptions = {}
  ) =>
    (parentSpan ?? Telemetry.captureContext()).run(() =>
      openDirectMessage(userId(), recipientId, (content, existing) => {
        openWithSplit(
          content,
          existing ? { ...options, reopen: 'latest' } : options
        );
      })
    );
}
