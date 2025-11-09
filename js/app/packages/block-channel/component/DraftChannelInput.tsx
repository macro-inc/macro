import { mapAttachmentsForSend } from '@block-channel/utils/inputAttachments';
import { getDestinationFromOptions } from '@core/component/NewMessage';
import type { InputAttachment } from '@core/store/cacheChannelInput';
import type { WithCustomUserInput } from '@core/user';
import { useSendMessageToPeople } from '@core/util/channels';
import { isErr } from '@core/util/maybeResult';
import { commsServiceClient } from '@service-comms/client';
import type { SimpleMention } from '@service-comms/generated/models/simpleMention';
import { createSignal, Show } from 'solid-js';
import { BaseInput } from './BaseInput';

export function DraftChannelInput(props: {
  selectedRecipients: () => WithCustomUserInput<'user' | 'contact'>[];
  channelName: () => string;
  inputAttachments?: {
    store: Record<string, InputAttachment[]>;
    setStore: any;
    key: string;
  };
}) {
  const [content, setContent] = createSignal('');

  const [error, setError] = createSignal(false);
  const [errorMsg, setErrorMsg] = createSignal('');

  function failure(msg: string) {
    setError(true);
    setErrorMsg(msg);
  }

  const { sendToUsers, sendToChannel } = useSendMessageToPeople();

  const handleSend = async (args: {
    content: string | undefined;
    attachments: InputAttachment[];
    threadId?: string;
    mentions?: SimpleMention[];
  }) => {
    setError(false);
    const recipients = props?.selectedRecipients?.();

    if (!recipients || recipients.length === 0) {
      const e = 'Please select at least one recipient';
      failure(e);
      throw new Error(e);
    }

    if (!args.content?.trim()) {
      const e = 'Please enter a message';
      failure(e);
      throw new Error(e);
    }

    const destination = getDestinationFromOptions(recipients);
    if (!destination) {
      const e = 'Invalid destination';
      failure(e);
      throw new Error(e);
    }
    try {
      if (
        destination.type === 'users' &&
        props.channelName() &&
        destination.users.length > 1
      ) {
        const res = await commsServiceClient.createChannel({
          channel_type: 'private',
          name: props.channelName() ?? null,
          participants: destination.users,
        });
        if (isErr(res)) {
          const e = 'Could not create channel';
          failure(e);
          throw new Error(e);
        }
        const [, { id }] = res;
        await sendToChannel({
          channelId: id,
          content: args.content || '',
          mentions: args.mentions || [],
          navigate: { navigate: true, mergeHistory: true },
          attachments: mapAttachmentsForSend(args.attachments),
        });
      } else if (destination.type === 'users') {
        await sendToUsers({
          users: destination.users,
          content: args.content || '',
          mentions: args.mentions || [],
          navigate: { navigate: true, mergeHistory: true },
          attachments: mapAttachmentsForSend(args.attachments),
        });
      } else if (destination.type === 'channel') {
        await sendToChannel({
          channelId: (destination as any).id,
          content: args.content || '',
          mentions: args.mentions || [],
          navigate: { navigate: true, mergeHistory: true },
          attachments: mapAttachmentsForSend(args.attachments),
        });
      }
      setContent('');
    } catch (error) {
      failure('Failed to send message');
      throw error;
    }
  };

  return (
    <>
      <Show when={error()}>
        <div class="text-sm font-mono text-failure-ink">{errorMsg()}</div>
      </Show>
      <BaseInput
        autoFocusOnMount={false}
        placeholder={`Send message${props?.channelName?.() ? ` to ${props.channelName()}` : ''}`}
        onStartTyping={() => {}}
        onStopTyping={() => {}}
        onSend={handleSend}
        onChange={setContent}
        onEmpty={() => setContent('')}
        initialValue={() => content()}
        inputAttachments={
          props.inputAttachments || {
            store: {},
            setStore: () => {},
            key: 'draft',
          }
        }
        onFocusLeaveStart={() => {}}
      />
    </>
  );
}
