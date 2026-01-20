import { useChatInput } from '@core/component/AI/component/input/useChatInput';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import type { CreateAndSend, Send } from '@core/component/AI/types';
import { isErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { Show } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

export function SoupChatInput() {
  const splitPanelContext = useSplitPanelOrThrow();
  const [preview] = splitPanelContext.previewState;

  const { ChatInput } = useChatInput();

  const handleSend = async (request: Send | CreateAndSend) => {
    if (request.type !== 'createAndSend') return;

    // Create a new persistent chat
    const response = await cognitionApiServiceClient.createChat({
      isPersistent: true,
    });
    if (isErr(response)) {
      console.error('Failed to create chat', response);
      return;
    }
    const [, { id: chatId }] = response;

    // Store the pending send data for the chat to pick up
    setPendingSendData({
      content: request.content,
      attachments: request.attachments,
      model: request.model,
    });

    // Replace the soup split with the chat split
    splitPanelContext.handle.replace({
      next: { type: 'chat', id: chatId },
    });
  };

  return (
    <Show when={!preview()}>
      <div class="absolute bottom-2 left-1/2 -translate-x-1/2 w-full max-w-3xl z-10 pointer-events-none">
        <div class="pointer-events-auto">
          <ChatInput
            onSend={handleSend}
            isPersistent={true}
            autoFocusOnMount={false}
          />
        </div>
      </div>
    </Show>
  );
}
