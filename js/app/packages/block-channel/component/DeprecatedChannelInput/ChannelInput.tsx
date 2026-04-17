import {
  clearDraftMessage,
  loadDraftMessage,
  saveDraftMessage,
} from '@block-channel/component/DeprecatedChannelInput/draftMessages';
import type {
  DraftMessage,
  InputAttachment,
} from '@core/store/cacheChannelInput';
import type { IUser } from '@core/user';
import { channelParticipantInfo } from '@core/user/util';
import { usePostTypingUpdateMutation } from '@queries/channel/typing';
import type { ChannelParticipant } from '@queries/channel/types';
import { type Accessor, createMemo, createSignal, onMount } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { BaseInput } from './BaseInput';
import { useSendChannelMessage } from '@block-channel/component/DeprecatedChannelInput/message';

export type ChannelInputProps = {
  channelId: string;
  inputAttachmentsStore: Record<string, InputAttachment[]>;
  setInputAttachmentsStore: SetStoreFunction<Record<string, InputAttachment[]>>;
  inputAttachmentsKey: string;
  channelName: string;
  participants: ChannelParticipant[];
  onFocusLeaveStart?: (e: KeyboardEvent) => void;
  autoFocusOnMount?: boolean;
  domRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
  isDraggingOverChannel?: Accessor<boolean>;
  isValidChannelDrag?: Accessor<boolean>;
};

export function ChannelInput(props: ChannelInputProps) {
  const sendMessage = useSendChannelMessage(() => props.channelId);
  const typingMutation = usePostTypingUpdateMutation();

  const channelUsers = createMemo<IUser[]>(() => {
    return props.participants.map(channelParticipantInfo);
  });

  const handleChange = (content: string) => {
    if (!props.channelId) return;
    saveDraftMessage(props.channelId, {
      content,
      attachments: props.inputAttachmentsStore[props.inputAttachmentsKey] ?? [],
    });
  };

  const [draftMessage, setDraftMessage] = createSignal<DraftMessage | null>(
    null
  );

  onMount(() => {
    if (!props.channelId) return;
    const draft = loadDraftMessage(props.channelId);
    if (draft) {
      setDraftMessage(draft);
      props.setInputAttachmentsStore(
        props.inputAttachmentsKey,
        draft.attachments
      );
    }
  });

  return (
    <BaseInput
      placeholder={`Message ${props.channelName} — @mention to share`}
      onStartTyping={() =>
        typingMutation.mutate({ channelId: props.channelId, action: 'start' })
      }
      onStopTyping={() =>
        typingMutation.mutate({ channelId: props.channelId, action: 'stop' })
      }
      onSend={sendMessage}
      afterSend={() => clearDraftMessage(props.channelId)}
      onChange={handleChange}
      initialValue={() => draftMessage()?.content ?? ''}
      inputAttachments={{
        store: props.inputAttachmentsStore,
        setStore: props.setInputAttachmentsStore,
        key: props.inputAttachmentsKey,
      }}
      onFocusLeaveStart={props.onFocusLeaveStart}
      closeDraft={() => clearDraftMessage(props.channelId)}
      channelUsers={channelUsers}
      autoFocusOnMount={props.autoFocusOnMount}
      domRef={props.domRef}
      isDraggingOverChannel={props.isDraggingOverChannel}
      isValidChannelDrag={props.isValidChannelDrag}
    />
  );
}

export { DraftChannelInput } from './DraftChannelInput';
