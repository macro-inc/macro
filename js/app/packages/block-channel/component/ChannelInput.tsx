import { channelStore, sendMessage } from '@block-channel/signal/channel';
import { postTypingUpdate } from '@block-channel/signal/typing';
import {
  clearDraftMessage,
  loadDraftMessage,
  saveDraftMessage,
} from '@block-channel/utils/draftMessages';
import { useBlockId } from '@core/block';
import type {
  DraftMessage,
  InputAttachment,
} from '@core/store/cacheChannelInput';
import type { IUser } from '@core/user';
import { channelParticipantInfo } from '@core/user/util';
import { createCallback } from '@solid-primitives/rootless';
import { createMemo, createSignal, onMount } from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import { BaseInput } from './BaseInput';

export type ChannelInputProps = {
  inputAttachmentsStore: Record<string, InputAttachment[]>;
  setInputAttachmentsStore: SetStoreFunction<Record<string, InputAttachment[]>>;
  inputAttachmentsKey: string;
  channelName: string;
  onFocusLeaveStart?: (e: KeyboardEvent) => void;
  autoFocusOnMount?: boolean;
  domRef?: (ref: HTMLDivElement) => void | HTMLDivElement;
};

export function ChannelInput(props: ChannelInputProps) {
  const channelId = useBlockId();

  const sendMessage_ = createCallback(
    async (args: Parameters<typeof sendMessage>[0]) => {
      await sendMessage(args);
    }
  );
  const postTypingUpdate_ = createCallback(postTypingUpdate);

  const channel = channelStore.get;
  const channelUsers = createMemo<IUser[]>(() => {
    const participants = channel.participants ?? [];
    return participants.map(channelParticipantInfo);
  });

  const handleChange = createCallback((content: string) => {
    if (!channelId) return;
    saveDraftMessage(channelId, {
      content,
      attachments: props.inputAttachmentsStore[props.inputAttachmentsKey] ?? [],
    });
  });

  const [draftMessage, setDraftMessage] = createSignal<DraftMessage | null>(
    null
  );

  onMount(() => {
    if (!channelId) return;
    const draft = loadDraftMessage(channelId);
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
      placeholder={`Send a message to ${props.channelName}`}
      onStartTyping={() => postTypingUpdate_('start')}
      onStopTyping={() => postTypingUpdate_('stop')}
      onSend={sendMessage_}
      afterSend={() => clearDraftMessage(channelId)}
      onChange={handleChange}
      onEmpty={() => clearDraftMessage(channelId)}
      initialValue={() => draftMessage()?.content ?? ''}
      inputAttachments={{
        store: props.inputAttachmentsStore,
        setStore: props.setInputAttachmentsStore,
        key: props.inputAttachmentsKey,
      }}
      onFocusLeaveStart={props.onFocusLeaveStart}
      channelUsers={channelUsers}
      autoFocusOnMount={props.autoFocusOnMount}
      domRef={props.domRef}
    />
  );
}

export { DraftChannelInput } from './DraftChannelInput';
