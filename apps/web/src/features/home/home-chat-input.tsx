import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import { useChatInputContext } from '@core/component/AI/context';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { createMentionAttachmentCallbacks } from '@core/component/AI/signal/mention-attachment-callbacks';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isPaymentError } from '@core/util/handlePaymentError';
import { createRenameDssEntityMutation } from '@entity';
import { invalidateAllSoup } from '@queries/soup/normalized-cache';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { $getRoot } from 'lexical';
import { createEffect } from 'solid-js';
import { replaceHomeComposerDraft } from './home-composer-selection';

export const HomeChatInput = (props: {
  variant?: 'default' | 'tall';
  class?: string;
  placeholder?: string;
  autoFocusOnMount?: boolean;
  /**
   * Where a newly created chat opens. By default the composer's split is
   * replaced with the chat block; a host that keeps its own chrome around
   * the conversation (the Agents view and its sidebar) opens it in place.
   */
  openChat?: (chatId: string) => void;
}) => {
  const splitPanelContext = useSplitPanelOrThrow();
  const input = useChatInputContext();

  const { getAttachmentFromMention } = useGetChatAttachmentInfo();
  const attachmentMentionCallbacks = createMentionAttachmentCallbacks(
    input.attachments,
    getAttachmentFromMention
  );
  const editor = buildChatEditor().withMentions({
    ...attachmentMentionCallbacks,
    block: 'chat',
    showOpenTabs: true,
  });

  const applyDraft = (text: string) => {
    replaceHomeComposerDraft(editor.controls, text);
    requestAnimationFrame(() => {
      editor.controls.focus();
      // Focus lands at the start of the document; drafts are prompt prefixes,
      // so the caret belongs at the end, ready to complete the sentence.
      editor.controls.getLexical().update(() => {
        $getRoot().selectEnd();
      });
    });
  };

  // Drafts requested from elsewhere on the home (e.g. a suggested action row).
  createEffect(() => {
    const draft = input.pendingDraft();
    if (draft != null) {
      applyDraft(draft);
      input.setPendingDraft(null);
    }
  });

  registerHotkey({
    hotkey: 'enter',
    scopeId: splitPanelContext.splitHotkeyScope,
    description: 'Focus Chat Input',
    keyDownHandler: () => {
      editor.controls.focus();
      return true;
    },
    hotkeyToken: TOKENS.block.focus,
    hide: true,
  });

  const renameMutation = createRenameDssEntityMutation();

  const handleSend = async (request: ChatSendInput) => {
    const backgroundSend = request.metaKey;

    // Create a new persistent chat
    const response = await cognitionApiServiceClient.createChat({});
    if (response.isErr()) {
      input.attachments.setAttached(request.attachments);
      replaceHomeComposerDraft(editor.controls, request.content);
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
        toolset: request.toolset,
      });
      invalidateAllSoup();
    } else {
      // Store the pending send data for the chat to pick up
      setPendingSendData({
        content: request.content,
        attachments: request.attachments,
        model: request.model,
      });

      if (props.openChat) {
        props.openChat(chatId);
      } else {
        // Replace the soup split with the chat split
        splitPanelContext.handle.replace({
          next: { type: 'chat', id: chatId },
        });
      }
    }
  };

  return (
    <ChatInput
      variant={props.variant ?? 'default'}
      class={props.class}
      placeholder={props.placeholder}
      editor={editor}
      onSend={handleSend}
      onEscape={() => {
        splitPanelContext.panelRef()?.focus();
        return true;
      }}
      isPersistent={true}
      autoFocusOnMount={props.autoFocusOnMount ?? true}
    />
  );
};
