import { useSoup } from '@app/component/next-soup/soup-context';
import { useAnalytics } from '@app/component/analytics-context';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { Hotkey } from '@core/component/Hotkey';
import { Tooltip } from '@core/component/Tooltip';
import { ENABLE_SNAPSHOT_NODE } from '@core/constant/featureFlags';
import { pressedKeys } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import { isErr } from '@core/util/maybeResult';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import { createRenameDssEntityMutation } from '@macro-entity';
import { invalidateAllSoup } from '@queries/soup/cache';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { ChatInput } from 'core/component/AI/component/input/ChatInput';
import { registerHotkey, useHotkeyDOMScope } from 'core/hotkey/hotkeys';
import { onMount, Show } from 'solid-js';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

function SoupChatInputInner() {
  const analytics = useAnalytics();
  let containerRef!: HTMLDivElement;
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
    useSnapshotForDocuments: ENABLE_SNAPSHOT_NODE,
  });

  const [attachHotkeys] = useHotkeyDOMScope('soup.chatInput');

  const metaHeld = () => pressedKeys().has('cmd');

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
      editor.controls.focus();
      return true;
    },
  });

  const renameMutation = createRenameDssEntityMutation();

  const handleSend = async (request: ChatSendInput) => {
    const backgroundSend = request.metaKey;

    // Create a new persistent chat
    const response = await cognitionApiServiceClient.createChat({});
    if (isErr(response)) {
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
    <Show when={!soup.previewEntity()}>
      <div
        ref={containerRef}
        class="absolute bottom-px right-px left-px pb-2 px-2 flex justify-center pointer-events-none"
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
                <Tooltip
                  tooltip="⌘ Enter to send in background"
                  placement="top"
                >
                  <div
                    class="flex items-center gap-1"
                    classList={{
                      'text-accent': metaHeld(),
                    }}
                  >
                    <div
                      class="flex border text-[0.625rem] rounded-xs items-center px-1 py-0.5"
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
    </Show>
  );
}

document.addEventListener('focusin', (f) => console.log('focus changed', f));
document.addEventListener('focusout', (f) => console.log('focus changed', f));
document.addEventListener('focus', (f) => console.log('focus changed', f));

export function SoupChatInput() {
  return (
    <ChatInputProvider autoAttach={false}>
      <SoupChatInputInner />
    </ChatInputProvider>
  );
}
