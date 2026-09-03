import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { createMentionAttachmentCallbacks } from '@core/component/AI/signal/mention-attachment-callbacks';
import type { Attachment, Model } from '@core/component/AI/types';
import { onMount } from 'solid-js';

function EditableChatMessageInner(props: {
  chatId: string;
  initialText: string;
  attachments: Attachment[];
  onAccept: (r: ChatSendInput) => void;
  onCancel: () => void;
  model: Model;
}) {
  const input = useChatInputContext();
  const { getAttachmentFromMention } = useGetChatAttachmentInfo();
  const attachmentMentionCallbacks = createMentionAttachmentCallbacks(
    input.attachments,
    getAttachmentFromMention
  );
  const editor = buildChatEditor().withMentions({
    ...attachmentMentionCallbacks,
    block: 'chat',
    showOpenTabs: true,
  });

  onMount(() => {
    editor.controls.focus();
  });

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onCancel();
    }
  };

  return (
    <div onKeyDown={handleKey} class="w-full">
      <ChatInput
        editor={editor}
        initialValue={props.initialText}
        chatId={props.chatId}
        onSend={(request) => props.onAccept(request)}
      />
    </div>
  );
}

export function EditableChatMessage(props: {
  chatId: string;
  initialText: string;
  attachments: Attachment[];
  onAccept: (r: ChatSendInput) => void;
  onCancel: () => void;
  model: Model;
}) {
  return (
    <ChatInputProvider
      model={props.model}
      isGenerating={false}
      initialAttachments={props.attachments}
    >
      <EditableChatMessageInner
        chatId={props.chatId}
        initialText={props.initialText}
        attachments={props.attachments}
        onAccept={props.onAccept}
        onCancel={props.onCancel}
        model={props.model}
      />
    </ChatInputProvider>
  );
}
