import { selectConversationRecipients } from '@app/features/agent-dms/core/personas';
import type { CombinedRecipientItem, WithCustomUserInput } from '@core/user';
import type { RecipientSourceInput } from '@core/user/recipient-source';
import type { useSendMessageToPeople } from '@core/util/channels';
import { Telemetry } from '@macro-inc/observability';
import { useCombinedRecipientSource } from '@queries/contacts/recipient-source';
import { createMemo, createSignal } from 'solid-js';

/** Who a new message can go to: people, agents, or one existing channel. */
export type MessageRecipient = WithCustomUserInput<
  'user' | 'contact' | 'agent' | 'channel'
>;

/**
 * The To field of a new message, shared by the new-message composer and the
 * native share sheet. A message goes to people or to one existing channel,
 * never both: channels are offered only while nothing is picked, and a picked
 * channel fills the field (pass `isFull` to `RecipientSelector.full`) until it
 * is removed.
 */
export function createMessageRecipients() {
  const [selected, setSelected] = createSignal<MessageRecipient[]>([]);

  const select = (next: MessageRecipient[]) => {
    setSelected(selectConversationRecipients(next));
  };

  const selectedChannel = () => {
    const recipient = selected()[0];
    return recipient?.kind === 'channel' ? recipient : undefined;
  };

  const createSource = (input: RecipientSourceInput) => {
    const source = useCombinedRecipientSource(input);
    const items = createMemo((): CombinedRecipientItem<'user' | 'channel'>[] =>
      selected().length === 0
        ? source.items()
        : source.items().filter((item) => item.kind !== 'channel')
    );
    return { ...source, items };
  };

  return {
    selected,
    select,
    selectedChannel,
    isFull: () => selectedChannel() !== undefined,
    createSource,
  };
}

type SendToChannel = ReturnType<typeof useSendMessageToPeople>['sendToChannel'];
type ChannelPost = Pick<
  Parameters<SendToChannel>[0],
  'channelId' | 'content' | 'mentions' | 'attachments'
>;

/**
 * Posts a new message into an existing channel without leaving the current
 * view. Throws when the post fails, so the caller keeps the draft; the result
 * can open the channel at the message.
 */
export function postToExistingChannel(
  sendToChannel: SendToChannel,
  args: ChannelPost & {
    /** The span name, one per surface. */
    span: string;
  }
) {
  return Telemetry.span(args.span, async (span) => {
    span.setAttr('channel.id', args.channelId);
    const sent = await sendToChannel({
      channelId: args.channelId,
      content: args.content,
      mentions: args.mentions,
      attachments: args.attachments,
      navigate: { navigate: false, mergeHistory: true },
      parentSpan: Telemetry.captureContext(),
    });
    span.setAttr(`${args.span}.outcome`, sent ? 'sent' : 'failed');
    if (!sent)
      throw new Error('Could not send your message. Your draft has been kept.');
    return sent;
  });
}
