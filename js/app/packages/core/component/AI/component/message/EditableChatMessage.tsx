import { ChatInput } from '@core/component/AI/component/input/useChatInput';
import { useChatMarkdownArea } from '@core/component/AI/component/input/useChatMarkdownArea';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import type { Attachment, Model, Send } from '@core/component/AI/types';
import { asEditRequest } from '@core/component/AI/types/util';
import { onMount } from 'solid-js';

function EditableChatMessageInner(props: {
  chatId: string;
  initialText: string;
  attachments: Attachment[];
  onAccept: (r: Send) => void;
  onCancel: () => void;
  model: Model;
}) {
  const input = useChatInputContext();
  const chatMarkdownArea = useChatMarkdownArea({
    initialValue: props.initialText,
    addAttachment: (a) => input.attachments.addAttachment(a),
  });

  onMount(() => {
    chatMarkdownArea.focus();
  });

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onCancel();
    }
  };

  return (
    <div onKeyDown={handleKey} class="w-full">
      <ChatInput
        markdown={chatMarkdownArea}
        chatId={props.chatId}
        onSend={(request) => {
          if (request.type === 'send') props.onAccept(asEditRequest(request));
        }}
      />
    </div>
  );
}

export function EditableChatMessage(props: {
  chatId: string;
  initialText: string;
  attachments: Attachment[];
  onAccept: (r: Send) => void;
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
