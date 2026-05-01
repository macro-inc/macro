import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import type { Attachment, Model } from '@core/component/AI/types';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import { onMount } from 'solid-js';
import { useAnalytics } from '@app/component/analytics-context';

function EditableChatMessageInner(props: {
  chatId: string;
  initialText: string;
  attachments: Attachment[];
  onAccept: (r: ChatSendInput) => void;
  onCancel: () => void;
  model: Model;
}) {
  const analytics = useAnalytics();

  const input = useChatInputContext();
  const { getAttachmentFromMention } = useGetChatAttachmentInfo();

  const editor = buildChatEditor().withMentions({
    onCreate: (mention) => {
      analytics.track('mentions_menu_use', { itemType: 'chat' });
      const attachment = getAttachmentFromMention(mention);
      if (attachment) input.attachments.addAttachment(attachment);
    },
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
