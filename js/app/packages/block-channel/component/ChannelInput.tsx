import { useSendChannelMessageAction } from '@block-channel/signal/channel';
import { postTypingUpdate } from '@block-channel/signal/typing';
import {
  clearDraftMessage,
  loadDraftMessage,
  saveDraftMessage,
} from '@block-channel/utils/draftMessages';
import type {
  DraftMessage,
  InputAttachment,
} from '@core/store/cacheChannelInput';
import type { IUser } from '@core/user';
import { channelParticipantInfo } from '@core/user/util';
import type { ChannelParticipant } from '@service-comms/generated/models/channelParticipant';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo, createSignal, onMount } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { BaseInput } from './BaseInput';

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
};

export function ChannelInput(props: ChannelInputProps) {
  const sendMessage = useSendChannelMessageAction(() => props.channelId);

  const postTypingUpdate_ = createCallback((action: 'start' | 'stop') =>
    postTypingUpdate(props.channelId, action)
  );

  const channelUsers = createMemo<IUser[]>(() => {
    return props.participants.map(channelParticipantInfo);
  });

  const handleChange = createCallback((content: string) => {
    if (!props.channelId) return;
    saveDraftMessage(props.channelId, {
      content,
      attachments: props.inputAttachmentsStore[props.inputAttachmentsKey] ?? [],
    });
  });

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
      onStartTyping={() => postTypingUpdate_('start')}
      onStopTyping={() => postTypingUpdate_('stop')}
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
    />
  );
}

export { DraftChannelInput } from './DraftChannelInput';
