import { useAgentDmRecipients } from '@app/features/agent-dms/agent-dm-recipients';
import { selectConversationRecipients } from '@app/features/agent-dms/core/personas';
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
import { useSendMessageToPeople } from '@core/util/channels';
import { getDestinationFromOptions } from '@core/util/destination';
import InfoIcon from '@icon/system/regular/info.svg';
import { useCreateChannelMutation } from '@queries/channel/channels';
import { useGetOrCreateDirectMessageMutation } from '@queries/channel/get-or-create-dm';
import { createEffect, createMemo, createSignal, on } from 'solid-js';
import { useContactRecipientSource } from '@queries/contacts/recipient-source';

export function ChannelCompose() {
  const [channelName, setChannelName] = createSignal<string>('');

  const agentOptions = ENABLE_AGENT_DMS ? useAgentDmRecipients() : () => [];
  const [selectedRecipients, setSelectedRecipients] = createSignal<
    WithCustomUserInput<'user' | 'contact' | 'agent'>[]
  >([]);

  const selectRecipients = (
    next: WithCustomUserInput<'user' | 'contact' | 'agent'>[]
  ) => {
    setSelectedRecipients(selectConversationRecipients(next));
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
    if (recipients.length === 0) {
      return 'Draft message';
    } else if (recipients.length === 1) {
      const dmName = dmUserName();
      return dmName ? `DM with ${dmName}` : 'Draft message';
    } else {
      const names = recipients
        .slice(0, 2)
        .map((r) => {
          if (r.kind === 'agent') return r.data.name;
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
    const name = channelName();
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
            <RecipientSelector<'user' | 'contact' | 'agent'>
              options={agentOptions}
              createSource={useContactRecipientSource}
              selectedOptions={selectedRecipients()}
              setSelectedOptions={selectRecipients}
              placeholder={
                ENABLE_AGENT_DMS
                  ? 'To: People, agents, or email addresses'
                  : 'To: Macro users or email addresses'
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
