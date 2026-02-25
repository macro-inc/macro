import { useSoup } from '@app/component/next-soup/soup-context';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { useChatMarkdownArea } from '@core/component/AI/component/input/useChatMarkdownArea';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { TOKENS } from '@core/hotkey/tokens';
import { isErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { ChatInput } from 'core/component/AI/component/input/ChatInput';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { onMount, Show } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

function SoupChatInputInner() {
  let containerRef!: HTMLDivElement;
  const splitPanelContext = useSplitPanelOrThrow();
  const soup = useSoup();
  const input = useChatInputContext();

  const chatMarkdownArea = useChatMarkdownArea({
    addAttachment: (a) => input.attachments.addAttachment(a),
  });

  const [attachHotkeys] = useHotkeyDOMScope('soup.chatInput');

  onMount(() => {
    attachHotkeys(containerRef);
  });

  // cmd+j - Focus the soup chat input
  registerHotkey({
    hotkey: 'cmd+j',
    scopeId: splitPanelContext.splitHotkeyScope,
    hotkeyToken: TOKENS.chat.input.focus,
    description: 'Focus chat input',
    keyDownHandler: () => {
      chatMarkdownArea.focus();
      return true;
    },
  });

  const handleSend = async (request: ChatSendInput) => {
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
    <Show when={!soup.previewEntity()}>
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
              markdown={chatMarkdownArea}
              onSend={handleSend}
              onEscape={() => {
                splitPanelContext.panelRef()?.focus();
                return true;
              }}
              isPersistent={true}
              autoFocusOnMount={false}
            />
          </div>
        </div>
      </div>
    </Show>
  );
}

export function SoupChatInput() {
  return (
    <ChatInputProvider autoAttach={false}>
      <SoupChatInputInner />
    </ChatInputProvider>
  );
}
