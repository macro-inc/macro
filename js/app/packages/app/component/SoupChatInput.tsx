import { useAnalytics } from '@app/component/analytics-context';
import { useSoup } from '@app/component/next-soup/soup-context';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { TOKENS } from '@core/hotkey/tokens';
import { isPaymentError } from '@core/util/handlePaymentError';

import { createRenameDssEntityMutation } from '@macro-entity';
import { invalidateAllSoup } from '@queries/soup/cache';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { ChatInput } from 'core/component/AI/component/input/ChatInput';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { onMount } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

function SoupChatInputInner() {
  const analytics = useAnalytics();
  const splitPanelContext = useSplitPanelOrThrow();
  const soup = useSoup();
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

  const [attachHotkeys] = useHotkeyDOMScope('soup.chatInput');

  let containerRef!: HTMLDivElement;

  onMount(() => {
    attachHotkeys(containerRef);
  });

  // cmd+j - Focus AI chat
  registerHotkey({
    hotkey: 'cmd+j',
    scopeId: splitPanelContext.splitHotkeyScope,
    hotkeyToken: TOKENS.chat.input.focus,
    description: 'Focus AI chat',
    keyDownHandler: () => {
      editor.controls.focus();
      return true;
    },
  });

  const renameMutation = createRenameDssEntityMutation();

  const handleSend = async (request: ChatSendInput) => {
    const backgroundSend = request.metaKey;

    // Create a new persistent chat
    const response = await cognitionApiServiceClient.createChat({});
    if (response.isErr()) {
      if (isPaymentError(response)) {
        const { showPaywall } = usePaywallState();
        showPaywall(PaywallKey.CHAT_LIMIT);
      }
      return;
    }
    const { id: chatId } = response.value;

    // Rename via mutation for optimistic cache updates (history, preview, soup)
    const name = deriveChatName(request.content);
    if (name) {
      renameMutation.mutate({
        entity: { type: 'chat', id: chatId, name: '', ownerId: '' },
        newName: name,
      });
    }

    if (backgroundSend) {
      // Send the message in the background without navigating
      cognitionApiServiceClient.sendStreamChatMessage({
        content: request.content,
        model: request.model,
        chat_id: chatId,
        attachments:
          request.attachments.length > 0 ? request.attachments : undefined,
        toolset: { type: 'all' },
      });
      invalidateAllSoup();
    } else {
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
    }
  };

  return (
    <div
      ref={containerRef}
      class="absolute bottom-0 inset-x-px pb-2 px-2 flex justify-center pointer-events-none"
      classList={{ hidden: !!soup.previewEntity() }}
      style={{
        'background-image': `linear-gradient(transparent, var(--color-surface) 85%)`,
      }}
    >
      <div class="w-full max-w-3xl">
        <div class="pointer-events-auto">
          <ChatInput
            editor={editor}
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
  );
}

export function SoupChatInput() {
  return (
    <ChatInputProvider>
      <SoupChatInputInner />
    </ChatInputProvider>
  );
}
