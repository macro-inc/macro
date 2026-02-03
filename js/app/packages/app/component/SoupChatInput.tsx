import { useChatInput } from '@core/component/AI/component/input/useChatInput';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import type { CreateAndSend, Send } from '@core/component/AI/types';
import { isErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { onMount, Show } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

export function SoupChatInput() {
  let containerRef!: HTMLDivElement;
  const splitPanelContext = useSplitPanelOrThrow();
  const [preview] = splitPanelContext.previewState;

  const { ChatInput } = useChatInput();
  const [attachHotkeys] = useHotkeyDOMScope('soup.chatInput');

  onMount(() => {
    attachHotkeys(containerRef);
  });

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
      <div
        ref={containerRef}
        class="absolute z-10 bottom-0 pb-2 px-2 flex justify-center w-full pointer-events-none"
        style={{
          'background-image': `linear-gradient(transparent, var(--color-panel) 85%)`,
        }}
      >
        <div class="w-full max-w-3xl">
          <div class="pointer-events-auto">
            <ChatInput
              onSend={handleSend}
              isPersistent={true}
              autoFocusOnMount={false}
            />
          </div>
        </div>
      </div>
    </Show>
  );
}
