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
import { Hotkey } from '@core/component/Hotkey';
import { Tooltip } from '@core/component/Tooltip';
import { useHasPaidAccess } from '@core/auth/license';
import { ENABLE_SNAPSHOT_NODE } from '@core/constant/featureFlags';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { pressedKeys } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { isPaymentError } from '@core/util/handlePaymentError';
import { isErr } from '@core/util/maybeResult';
import { createRenameDssEntityMutation } from '@macro-entity';
import { invalidateAllSoup } from '@queries/soup/cache';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { ChatInput } from 'core/component/AI/component/input/ChatInput';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

function SoupChatInputInner() {
  const analytics = useAnalytics();
  const splitPanelContext = useSplitPanelOrThrow();
  const soup = useSoup();
  const input = useChatInputContext();
  const hasPaid = useHasPaidAccess();

  const { getAttachmentFromMention } = useGetChatAttachmentInfo();

  const editor = buildChatEditor().withMentions({
    onCreate: (mention) => {
      analytics.track('mentions_menu_use', { itemType: 'chat' });
      const attachment = getAttachmentFromMention(mention);
      if (attachment) input.attachments.addAttachment(attachment);
    },
    block: 'chat',
    showOpenTabs: true,
    useSnapshotForDocuments: ENABLE_SNAPSHOT_NODE,
  });

  const [attachHotkeys] = useHotkeyDOMScope('soup.chatInput');

  const [chatHasFocus, setChatHasFocus] = createSignal(false);
  const metaHeld = () => chatHasFocus() && pressedKeys().has('cmd');

  let containerRef!: HTMLDivElement;

  onMount(() => {
    attachHotkeys(containerRef);
    const focusIn = () => setChatHasFocus(true);
    const focusOut = () => setChatHasFocus(false);
    containerRef.addEventListener('focusin', focusIn);
    containerRef.addEventListener('focusout', focusOut);
    onCleanup(() => {
      containerRef.removeEventListener('focusin', focusIn);
      containerRef.removeEventListener('focusout', focusOut);
    });
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
    if (!hasPaid()) {
      const { showPaywall } = usePaywallState();
      showPaywall(PaywallKey.CHAT_LIMIT);
      return;
    }

    const backgroundSend = request.metaKey;

    // Create a new persistent chat
    const response = await cognitionApiServiceClient.createChat({});
    if (isErr(response)) {
      if (isPaymentError(response)) {
        const { showPaywall } = usePaywallState();
        showPaywall(PaywallKey.CHAT_LIMIT);
      }
      return;
    }
    const [, { id: chatId }] = response;

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
      class="absolute bottom-0 right-px left-px pb-2 px-2 flex justify-center pointer-events-none"
      classList={{ hidden: !!soup.previewEntity() }}
      style={{
        'background-image': `linear-gradient(transparent, var(--color-panel) 85%)`,
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
            extraRightControls={() => (
              <Tooltip tooltip="⌘ Enter to send in background" placement="top">
                <div
                  class="flex items-center gap-1"
                  classList={{
                    'text-accent': metaHeld(),
                  }}
                >
                  <div
                    class="flex border text-xxs rounded-xs items-center px-1 py-0.5"
                    classList={{
                      'border-accent text-accent': metaHeld(),
                      'border-edge-muted': !metaHeld(),
                    }}
                  >
                    <Hotkey shortcut="cmd+Enter" />
                  </div>
                  <span>Background</span>
                </div>
              </Tooltip>
            )}
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
