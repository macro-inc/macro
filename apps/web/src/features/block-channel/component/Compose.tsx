import { useAgentDmRecipients } from '@app/features/agent-dms/agent-dm-recipients';
import { selectConversationRecipients } from '@app/features/agent-dms/core/personas';
import { channelListName } from '@channel/group-chat-name';
import { buildPostMessageRequest, type InputSnapshot } from '@channel/Input';
import { DraftComposer } from '@channel/Input/DraftComposer';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { SplitToolbarLeft } from '@components/app/split-layout/components/SplitToolbar';
import { RecipientSelector } from '@core/component/RecipientSelector';
import { ENABLE_AGENT_DMS } from '@core/constant/featureFlags';
import {
  getDisplayName,
  tryMacroId,
  type WithCustomUserInput,
} from '@core/user';
import type { RecipientSourceInput } from '@core/user/recipient-source';
import { useSendMessageToPeople } from '@core/util/channels';
import { getDestinationFromOptions } from '@core/util/destination';
import { fireAndForget } from '@core/util/fireAndForget';
import InfoIcon from '@icon/system/regular/info.svg';
import { Telemetry } from '@macro-inc/observability';
import { useCreateChannelMutation } from '@queries/channel/channels';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import { useCombinedRecipientSource } from '@queries/contacts/recipient-source';
import { createEffect, createMemo, createSignal, on } from 'solid-js';

type ComposeRecipient = WithCustomUserInput<
  'user' | 'contact' | 'agent' | 'channel'
>;

export function ChannelCompose() {
  const [channelName, setChannelName] = createSignal<string>('');

  const agentOptions = ENABLE_AGENT_DMS ? useAgentDmRecipients() : () => [];
  const [selectedRecipients, setSelectedRecipients] = createSignal<
    ComposeRecipient[]
  >([]);

  const selectRecipients = (next: ComposeRecipient[]) => {
    setSelectedRecipients(selectConversationRecipients(next));
  };

  // A message goes to people or to one existing channel, never both: channels
  // are offered only while nothing is picked, and a picked channel fills the
  // field until it is removed.
  const selectedChannel = () => {
    const recipient = selectedRecipients()[0];
    return recipient?.kind === 'channel' ? recipient : undefined;
  };
  const createRecipientSource = (input: RecipientSourceInput) => {
    const source = useCombinedRecipientSource(input);
    const items = createMemo(() =>
      selectedRecipients().length === 0
        ? source.items()
        : source.items().filter((item) => item.kind !== 'channel')
    );
    return { ...source, items };
  };

  const selectedRecipientCount = createMemo(() => selectedRecipients().length);

  createEffect(
    on(selectedRecipientCount, (current, prev) => {
      if (prev === 1 && current === 2) {
        setChannelName('');
      } else if (prev === 1 && current === 0) {
        setChannelName('');
      }
    })
  );

  const dmUserId = createMemo(() => {
    if (selectedRecipients().length === 1) {
      return selectedRecipients()[0].data.id;
    }
    return undefined;
  });

  const dmUserName = createMemo(() => {
    const recipient = selectedRecipients()[0];
    if (recipient?.kind === 'agent') return recipient.data.name;
    const id = dmUserId();
    return id ? getDisplayName(tryMacroId(id)) : undefined;
  });

  const [triedToSubmit, _setTriedToSubmit] = createSignal(false);

  const previewName = createMemo(() => {
    const recipients = selectedRecipients();
    const channel = selectedChannel();
    if (channel) {
      return channelListName({
        name: channel.data.name ?? '',
        channelType: channel.data.channel_type,
      });
    }
    if (recipients.length === 0) {
      return 'Draft message';
    } else if (recipients.length === 1) {
      const dmName = dmUserName();
      return dmName ? `DM with ${dmName}` : 'Draft message';
    } else {
      const names = recipients
        .slice(0, 2)
        .map((r) => {
          if (r.kind === 'agent' || r.kind === 'channel') return r.data.name;
          if (r.kind === 'user') {
            return getDisplayName(tryMacroId(r.data.id));
          }
          return r.data.email || 'Unknown';
        })
        .filter(Boolean);

      if (recipients.length > 2) {
        return `Group chat with ${names.join(', ')}, and others`;
      } else {
        return `Group chat with ${names.join(' and ')}`;
      }
    }
  });

  const { sendToUsers, sendToChannel } = useSendMessageToPeople();
  const createChannelMutation = useCreateChannelMutation();
  const createDm = useGetOrCreateDirectMessageMutation();

  async function handleSend(snapshot: InputSnapshot) {
    const recipients = selectedRecipients();

    if (recipients.length === 0) {
      throw new Error('Please select at least one recipient');
    }

    const destination = getDestinationFromOptions(recipients);
    const { content, mentions, attachments } = buildPostMessageRequest({
      snapshot,
    });

    if (destination.type === 'channel') {
      const channelId = destination.id;
      return Telemetry.span(
        'channels.compose_send_to_channel',
        async (span) => {
          span.setAttr('channel.id', channelId);
          const sent = await sendToChannel({
            channelId,
            content,
            mentions,
            attachments,
            navigate: { navigate: false, mergeHistory: true },
            parentSpan: Telemetry.captureContext(),
          });
          span.setAttr(
            'channels.compose_send_to_channel.outcome',
            sent ? 'sent' : 'failed'
          );
          if (!sent)
            throw new Error(
              'Could not send your message. Your draft has been kept.'
            );
          // The message is in: a failed navigation must not keep the draft,
          // or sending it again would post it twice.
          fireAndForget(sent.navigateToChannel(), 'channel-compose');
        }
      );
    }

    const persona = recipients.find((recipient) => recipient.kind === 'agent');
    if (persona) {
      const dm = await createDm.mutateAsync({
        recipient_id: `bot|${persona.data.id}`,
      });
      const sent = await sendToChannel({
        channelId: dm.channel_id,
        content,
        mentions,
        attachments,
        navigate: { navigate: true, mergeHistory: true },
      });
      if (!sent)
        throw new Error(
          'Could not send your message. Your draft has been kept.'
        );
      return;
    }
    if (
      destination.type === 'users' &&
      channelName() &&
      destination.users.length > 1
    ) {
      const { id } = await createChannelMutation.mutateAsync({
        channel_type: 'private',
        name: channelName() ?? null,
        participants: destination.users,
      });
      await sendToChannel({
        channelId: id,
        content,
        mentions,
        attachments,
        navigate: { navigate: true, mergeHistory: true },
      });
    } else {
      await sendToUsers({
        users: destination.users,
        content,
        mentions,
        attachments,
        navigate: { navigate: true, mergeHistory: true },
      });
    }
  }

  const placeholder = createMemo(() => {
    const name = channelName() || (selectedChannel() && previewName());
    return name ? `Send message to ${name}` : 'Send message';
  });

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          class="ph-no-capture"
          label={channelName() || previewName()}
          iconType="channel"
          badges={[
            <SplitHeaderBadge text="draft" tooltip="This is a Draft Message" />,
          ]}
        />
      </SplitHeaderLeft>
      <SplitToolbarLeft>
        <div class="h-full items-center flex" p-1></div>
      </SplitToolbarLeft>
      <div class="relative flex flex-col size-full panel">
        <div class="pt-2 touch:pt-[calc(var(--mobile-content-inset-top)+.5rem)] size-full grow overflow-y-auto @min-[40rem]:px-4">
          <div class="macro-message-width macro-message-padding mx-auto pb-1 h-full">
            <input
              type="text"
              value={channelName()}
              disabled={selectedRecipients().length < 2}
              placeholder={previewName()}
              class="text-xl font-medium mb-6 mt-12 touch:mt-0 bg-transparent border-none outline-none w-full resize-none appearance-none focus:ring-0"
              style="box-shadow: none;"
              onInput={(e) => {
                if (selectedRecipients().length >= 2) {
                  setChannelName(e.currentTarget.value);
                }
              }}
            />
            <RecipientSelector<'user' | 'contact' | 'agent' | 'channel'>
              options={agentOptions}
              createSource={createRecipientSource}
              selectedOptions={selectedRecipients()}
              setSelectedOptions={selectRecipients}
              full={!!selectedChannel()}
              placeholder={
                ENABLE_AGENT_DMS
                  ? 'To: People, agents, channels, or email addresses'
                  : 'To: Macro users, channels, or email addresses'
              }
              triedToSubmit={triedToSubmit}
              focusOnMount
              hideMenuOnEscape
            />
            <div class="mt-6 p-3 flex flex-row items-center border border-edge-muted text-ink-placeholder rounded-md">
              <InfoIcon class="shrink-0 size-8 mr-4 fill-edge" />
              <p class="text-xs">
                Send a Macro message to anyone. Share your files, tasks, emails;
                you can <code>@mention</code> anything. If your message
                recipient is not already a Macro user, they will receive an
                email letting them know they received a message on Macro.
              </p>
            </div>
          </div>
        </div>
        <DraftComposer placeholder={placeholder()} onSend={handleSend} />
      </div>
    </>
  );
}
