import { useChatInput } from '@core/component/AI/component/input/useChatInput';
import type { Attachment, Model, Send } from '@core/component/AI/types';
import { asEditRequest } from '@core/component/AI/types/util';
import { onMount } from 'solid-js';

export function EditableChatMessage(props: {
  chatId: string;
  initialText: string;
  attachments: Attachment[];
  onAccept: (r: Send) => void;
  onCancel: () => void;
  model: Model;
}) {
  const { ChatInput, chatMarkdownArea } = useChatInput({
    initialAttachments: props.attachments,
    chatId: props.chatId,
    initialValue: props.initialText,
    model: props.model,
    isGenerating: false,
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
        onSend={(request) => {
          if (request.type === 'send') props.onAccept(asEditRequest(request));
        }}
      />
    </div>
  );
}
