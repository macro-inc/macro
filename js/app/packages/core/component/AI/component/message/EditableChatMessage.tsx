import {
  ChatContextProvider,
  useChatContext,
} from '@core/component/AI/context';
import { ChatInput } from '@core/component/AI/component/input/useChatInput';
import { useChatMarkdownArea } from '@core/component/AI/component/input/useChatMarkdownArea';
import type { Attachment, Model, Send } from '@core/component/AI/types';
import { asEditRequest } from '@core/component/AI/types/util';
import { onMount } from 'solid-js';

function EditableChatMessageInner(props: {
  initialText: string;
  attachments: Attachment[];
  onAccept: (r: Send) => void;
  onCancel: () => void;
  model: Model;
}) {
  const ctx = useChatContext();
  const chatMarkdownArea = useChatMarkdownArea({
    initialValue: props.initialText,
    addAttachment: (a) => ctx.attachments.addAttachment(a),
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
    <ChatContextProvider
      chatId={props.chatId}
      model={props.model}
      isGenerating={false}
      initialAttachments={props.attachments}
    >
      <EditableChatMessageInner
        initialText={props.initialText}
        attachments={props.attachments}
        onAccept={props.onAccept}
        onCancel={props.onCancel}
        model={props.model}
      />
    </ChatContextProvider>
  );
}
