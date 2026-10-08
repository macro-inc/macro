import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import {
  ChatInputProvider,
  useChatInputContext,
} from '@core/component/AI/context';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { createMentionAttachmentCallbacks } from '@core/component/AI/signal/mention-attachment-callbacks';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import { UPGRADE_MODEL } from '@core/component/AI/util/plan-model';
import {
  hasSawFreePlan,
  noteSawFreePlan,
} from '@core/component/AI/util/saw-free-plan';
import {
  explicitSoupModel,
  rememberSoupModelChoice,
  resolveSoupInitialModel,
  storeChatStateImmediate,
} from '@core/component/AI/util/storage';
import { enableChatV3Agents } from '@core/constant/featureFlags';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { useLicenseStatus, useUserId } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { isPaymentError } from '@core/util/handlePaymentError';
import { createRenameDssEntityMutation } from '@entity';
import { invalidateAllSoup } from '@queries/soup/cache';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { createEffect, on, Show } from 'solid-js';
import { MobileAgentComposer } from '../agents-view/mobile-agent-composer';

function SoupChatInputInner() {
  const splitPanelContext = useSplitPanelOrThrow();
  const input = useChatInputContext();
  const userId = useUserId();
  const licenseStatus = useLicenseStatus();

  // License is external. A free visit is recorded, and becoming paid restores
  // an explicit model or lands on Opus when the user never picked one.
  createEffect(
    on(licenseStatus, (status) => {
      if (!status) return;
      const paid = status === 'active' || status === 'trialing';
      if (!paid) {
        noteSawFreePlan(userId());
        return;
      }
      const chosen = explicitSoupModel();
      if (chosen) {
        if (input.model() !== chosen) input.setModel(chosen);
        return;
      }
      if (!hasSawFreePlan(userId())) return;
      if (input.model() !== UPGRADE_MODEL) input.setModel(UPGRADE_MODEL);
    })
  );

  const { getAttachmentFromMention } = useGetChatAttachmentInfo();
  const attachmentMentionCallbacks = createMentionAttachmentCallbacks(
    input.attachments,
    getAttachmentFromMention
  );
  const editor = buildChatEditor()
    .withAppLinkResolver(useMacroMentionLinkResolver())
    .withMentions({
      ...attachmentMentionCallbacks,
      block: 'chat',
      showOpenTabs: true,
    });

  const [attachHotkeys] = useHotkeyDOMScope('soup.chatInput');

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
    // Give list/recent icons the sent model before the new chat loads or its
    // server metadata refreshes, including when sending in the background.
    storeChatStateImmediate(chatId, { model: request.model });

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
    <div ref={attachHotkeys}>
      <ChatInput
        variant="default"
        collapseOnBlur
        editor={editor}
        onModelChosen={rememberSoupModelChoice}
        onSend={handleSend}
        onEscape={() => {
          splitPanelContext.panelRef()?.focus();
          return true;
        }}
        isPersistent={true}
        autoFocusOnMount={false}
      />
    </div>
  );
}

export function SoupChatInput() {
  const agents = useFeatureFlag(enableChatV3Agents);
  return (
    <Show when={!agents().loading}>
      <Show when={agents().enabled} fallback={<LegacySoupChatInput />}>
        <MobileAgentComposer />
      </Show>
    </Show>
  );
}

function LegacySoupChatInput() {
  const userId = useUserId();
  const licenseStatus = useLicenseStatus();
  const paid = () => {
    const status = licenseStatus();
    return status === 'active' || status === 'trialing';
  };
  // Seed the selector from the persisted soup draft model so the user's last
  // choice in the new-chat composer is restored. ChatInputProvider falls back
  // to DEFAULT_MODEL when this is undefined. A free plan with no real pick
  // starts on Opus once the user has upgraded.
  const initialModel = resolveSoupInitialModel({
    paid: paid(),
    sawFreePlan: hasSawFreePlan(userId()),
  });
  return (
    <ChatInputProvider model={initialModel}>
      <SoupChatInputInner />
    </ChatInputProvider>
  );
}
