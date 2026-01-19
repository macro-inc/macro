import { useChatInput } from '@core/component/AI/component/input/useChatInput';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import type {
  Attachment,
  CreateAndSend,
  Model,
  Send,
} from '@core/component/AI/types';
import { useBigChat } from '@core/signal/layout';

export function SoupChatInput() {
  const [, setBigChatOpen] = useBigChat();

  const { ChatInput, chatMarkdownArea, attachments, model } = useChatInput();

  // Store content before send since ChatInput clears it before calling onSend
  let pendingContent = '';
  let pendingAttachments: Attachment[] = [];
  let pendingModel: Model;

  // Track changes to capture content before it's cleared
  const captureState = () => {
    pendingContent = chatMarkdownArea.markdownText();
    pendingAttachments = attachments.attached();
    pendingModel = model();
  };

  const handleSend = (_request: Send | CreateAndSend) => {
    // Store the captured data for the rightbar to pick up
    if (pendingContent) {
      setPendingSendData({
        content: pendingContent,
        attachments: pendingAttachments,
        model: pendingModel,
      });
    }

    // Open bigchat - it will pick up the pending send
    setBigChatOpen(true);
  };

  return (
    <div
      class="absolute bottom-2 left-1/2 -translate-x-1/2 w-full max-w-3xl z-10 pointer-events-none"
      onKeyDown={captureState}
      onClick={captureState}
    >
      <div class="pointer-events-auto">
        <ChatInput
          onSend={handleSend}
          isPersistent={true}
          autoFocusOnMount={false}
        />
      </div>
    </div>
  );
}
