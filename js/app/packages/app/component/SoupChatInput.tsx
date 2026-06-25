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
import {
  getSoupInputStoredModel,
  storeSoupInputModel,
} from '@core/component/AI/util/storage';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { TOKENS } from '@core/hotkey/tokens';
import { isPaymentError } from '@core/util/handlePaymentError';

import { createRenameDssEntityMutation } from '@macro-entity';
import { invalidateAllSoup } from '@queries/soup/cache';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { ChatInput } from 'core/component/AI/component/input/ChatInput';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { createEffect, onMount } from 'solid-js';
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

  // Persist the model the user picks in the new-chat composer so it survives
  // reload/navigation, matching how the existing-chat draft model is restored.
  // ChatInput may reconcile to an available model if the user isn't entitled to
  // the stored one, and that corrected value flows through here too.
  createEffect(() => {
    storeSoupInputModel(input.model());
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
  // Seed the selector from the persisted soup draft model so the user's last
  // choice in the new-chat composer is restored. ChatInputProvider falls back
  // to DEFAULT_MODEL when this is undefined.
  const initialModel = getSoupInputStoredModel();
  return (
    <ChatInputProvider model={initialModel}>
      <SoupChatInputInner />
    </ChatInputProvider>
  );
}
