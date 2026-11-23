import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, idToEmail, tryMacroId } from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import { DirectMessageEmptyState } from '../Channel/DirectMessageEmptyState';
import { ChannelIcon } from '../channel-icon';
import { DraftComposer } from '../Input/DraftComposer';
import { buildPostMessageRequest } from '../Input/message-payload';
import type { InputSnapshot } from '../Input/types';
import { settlePendingDirectMessage } from '../primitives/pending-direct-messages';

type PendingDirectMessageProps = {
  /** The temporary channel id the conversation is open under. */
  pendingId: string;
  recipientId: string;
};

function recipientName(recipientId: string) {
  return getDisplayName(tryMacroId(recipientId)) || idToEmail(recipientId);
}

/** As a created DM's composer names them: "First Last" shortens to "First". */
function placeholderName(name: string) {
  const parts = name.split(' ');
  return parts.length === 2 ? parts[0] : name;
}

/** The DM's avatar and name, as a created DM's header shows them. */
export function PendingDirectMessageTitle(props: PendingDirectMessageProps) {
  const userId = useUserId();
  const participantIds = () => [userId() ?? '', props.recipientId];

  return (
    <div class="ph-no-capture flex min-w-0 shrink items-center gap-2">
      <span class="inline-flex size-4">
        <ChannelIcon
          channelId={props.pendingId}
          channelType="direct_message"
          participantIds={participantIds()}
          avatarSize="sm"
          class="[&_img]:rounded-full"
          suppressClick
          showTooltip={false}
        />
      </span>
      <span class="truncate text-sm font-semibold">
        {recipientName(props.recipientId)}
      </span>
    </div>
  );
}

/**
 * A DM with someone you haven't messaged yet, shown like an empty DM. Nothing
 * exists on the server until the first message: sending it creates the DM,
 * posts the message, and replaces this view with the conversation.
 */
export function PendingDirectMessage(props: PendingDirectMessageProps) {
  const { sendToUsers } = useSendMessageToPeople();

  const send = (snapshot: InputSnapshot) =>
    Telemetry.span('channels.send_first_direct_message', async (span) => {
      const { content, mentions, attachments } = buildPostMessageRequest({
        snapshot,
      });
      // Navigate once the message is in: the created DM replaces this entry,
      // so Back skips the conversation that no longer stands in for anything.
      const sent = await sendToUsers({
        users: [props.recipientId],
        content,
        mentions,
        attachments,
        navigate: { navigate: false, mergeHistory: true },
      });
      if (!sent) {
        span.setAttr('channels.send_first_direct_message.outcome', 'failed');
        throw new Error(
          'Could not send your message. Your draft has been kept.'
        );
      }
      span.setAttr('channel.id', sent.channelId);
      span.setAttr('channels.send_first_direct_message.outcome', 'sent');
      settlePendingDirectMessage(props.pendingId);
      fireAndForget(sent.navigateToChannel(), 'pending-direct-message');
    });

  return (
    <div class="relative flex flex-col size-full panel">
      <div class="flex min-h-0 grow flex-col overflow-y-auto touch:pt-(--mobile-content-inset-top)">
        <DirectMessageEmptyState />
      </div>
      <DraftComposer
        placeholder={`Type @ to share with ${placeholderName(recipientName(props.recipientId))}`}
        autofocus={!isTouchDevice()}
        onSend={send}
      />
    </div>
  );
}
