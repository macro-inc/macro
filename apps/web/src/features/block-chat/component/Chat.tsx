import type { SendBuilder } from '@block-chat/blockClient';
import { TopBar } from '@block-chat/component/TopBar';
import type { ChatData } from '@block-chat/definition';
import { pendingLocationParamsSignal } from '@block-chat/signal/pendingLocationParams';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { useCanAutofocusSplitContent } from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useHasPaidAccess } from '@core/auth/license';
import { useBlockId, useIsNestedBlock } from '@core/block';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { useSendChatMessage } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import { ChatMessages } from '@core/component/AI/component/message/ChatMessages';
import {
  alternateProviderModel,
  MODEL_PROVIDER,
  modelsForPlan,
} from '@core/component/AI/constant';
import {
  ChatInputProvider,
  ChatProvider,
  useChatContext,
  useChatInputContext,
} from '@core/component/AI/context';
import { useEntityDropAttachment } from '@core/component/AI/hook/useEntityDropAttachment';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { createMentionAttachmentCallbacks } from '@core/component/AI/signal/mention-attachment-callbacks';
import {
  getPendingSend,
  peekPendingSend,
} from '@core/component/AI/signal/pendingSend';
import { registerToolHandler } from '@core/component/AI/signal/tool';
import { insertChatAttachmentMention } from '@core/component/AI/util/chatAttachmentMention';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import { parseModel } from '@core/component/AI/util/parse';
import {
  getChatInputStoredState,
  type StoredStuff,
  storeChatState,
} from '@core/component/AI/util/storage';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { usePaywallState } from '@core/constant/PaywallState';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { createMethodRegistration } from '@core/orchestrator';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { createRenameDssEntityMutation } from '@entity';
import { invalidateUserQuota } from '@queries/auth';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { createCallback } from '@solid-primitives/rootless';
import { createEffect, createSignal, getOwner, Show, Suspense } from 'solid-js';

export function Chat(props: { data: ChatData }) {
  const loadedState = getChatInputStoredState(props.data.chat.id);

  // Seed the model selector, highest priority first:
  //  1. peekPendingSend — the model the user just sent with in the soup chat
  //     input, carried over the new-chat redirect and reflected in the new chat.
  //  2. loadedState.model — the per-chat draft: a model picked in this chat's
  //     input but not yet sent (persisted per chat id, so it survives reload /
  //     navigation, just like the draft text and attachments).
  //  3. the chat's stored model.
  // The chat input reconciles to an available model if the user isn't entitled
  // to this one.
  const initialModel =
    peekPendingSend()?.model ??
    loadedState.model ??
    parseModel(props.data.chat.model);

  return (
    <ChatInputProvider
      initialAttachments={loadedState.attachments}
      model={initialModel}
    >
      <ChatWithController
        data={props.data}
        loadedInputText={loadedState.input}
      />
    </ChatInputProvider>
  );
}

/**
 * Sits inside `ChatInputProvider` so the controller can be wired to model
 * state — specifically, so a provider-outage error toast can switch the chat
 * to a model from a different provider.
 */
function ChatWithController(props: {
  data: ChatData;
  loadedInputText: string | undefined;
}) {
  const { showPaywall } = usePaywallState();
  const input = useChatInputContext();
  const hasPaidAccess = useHasPaidAccess();

  // Providers that have failed during this chat session. We avoid bouncing the
  // user back to a provider we already know is down (e.g. Anthropic → OpenAI →
  // back to Anthropic). Lives for the life of this chat component.
  const failedProviders = new Set<string>();

  // The model we'd fall back to if the current one failed: a different,
  // non-failed provider drawn from the user's accessible models.
  const nextModel = () =>
    alternateProviderModel(input.model(), {
      candidates: [...modelsForPlan(hasPaidAccess())],
      failedProviders,
    });

  const onSwitchModel = () => {
    const alternate = nextModel();
    if (!alternate) return;
    // Record the provider that just failed before moving off it.
    failedProviders.add(MODEL_PROVIDER[input.model()]);
    input.setModel(alternate);
  };

  return (
    <ChatProvider
      chatId={props.data.chat.id}
      messages={props.data.chat.messages}
      controllerOptions={{
        onShowPaywall: showPaywall,
        onSwitchModel,
        hasAlternateModel: () => nextModel() !== undefined,
      }}
    >
      <ChatInner data={props.data} loadedInputText={props.loadedInputText} />
    </ChatProvider>
  );
}

function ChatInner(props: {
  data: ChatData;
  loadedInputText: string | undefined;
}) {
  const owner = getOwner();
  const input = useChatInputContext();
  const chat = useChatContext();
  const canEdit = useCanEdit();
  const disabled = () => !canEdit();
  const scopeId = blockHotkeyScopeSignal.get;
  const blockElement = blockElementSignal.get;
  const { navigatedFromJK } = useNavigatedFromJK();
  const canAutofocusSplitContent = useCanAutofocusSplitContent();
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const [showStreamDebug, setShowStreamDebug] = createSignal(false);
  const [markdownText, setMarkdownText] = createSignal(
    props.loadedInputText ?? ''
  );

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

  // Sync isGenerating from controller phase
  createEffect(() => {
    input.setIsGenerating(chat.isGenerating());
    if (chat.isGenerating()) invalidateUserQuota();
  });

  const blockHandle = blockHandleSignal.get;

  // Entity drag-and-drop support
  const chatId = useBlockId();
  const { droppable, isDraggingOver } = useEntityDropAttachment(
    'chat-input-' + chatId,
    input.attachments,
    (mention) =>
      insertChatAttachmentMention(editor.controls.getLexical(), mention)
  );
  false && droppable;

  registerToolHandler(() => {
    const s = chat.stream();
    if (!s) return undefined;
    return { data: s.data };
  });

  const sendChatMessage = useSendChatMessage();
  const renameMutation = createRenameDssEntityMutation();

  const onSend = createCallback(async (request: ChatSendInput) => {
    const isFirstMessage = chat.messages().length === 0;
    const optimisticId = crypto.randomUUID();

    chat.dispatch({
      type: 'send_started',
      optimisticMessage: {
        id: optimisticId,
        content: request.content,
        role: 'user',
        attachments: request.attachments ?? [],
      },
    });

    if (isFirstMessage) {
      const name = deriveChatName(request.content);
      if (name) {
        renameMutation.mutate({
          entity: { type: 'chat', id: chat.chatId(), name: '', ownerId: '' },
          newName: name,
        });
      }
    }

    const result = await sendChatMessage({
      ...request,
      chatId: chat.chatId(),
    });

    if ('error' in result) {
      chat.dispatch({
        type: 'send_failed',
        paymentError: result.paymentError,
      });
      return;
    }

    chat.dispatch({ type: 'stream_connected', stream: result.stream, owner });
    invalidateUserQuota();
  });

  const onStop = async () => {
    if (!chat.isGenerating()) return;
    const streamId = chat.stream()?.id()?.stream_id;
    if (!streamId) return;
    await cognitionApiServiceClient.stopChatStream({
      chat_id: chat.chatId(),
      stream_id: streamId,
    });
  };

  const saveChatState = (state: StoredStuff) => {
    storeChatState(props.data.chat.id, state);
  };

  createEffect(() => {
    const inputText = markdownText();
    const attached = input.attachments.attached();
    const model_ = input.model();
    saveChatState({ attachments: attached, input: inputText, model: model_ });
  });

  const setPendingLocation = pendingLocationParamsSignal.set;

  createMethodRegistration(blockHandle, {
    sendMessage: async (sendRequest: SendBuilder) => {
      onSend({
        content: sendRequest.userRequest,
        model: sendRequest.model ?? input.model(),
        attachments: sendRequest.attachments ?? [],
        toolset: { type: 'all' },
      });
    },
    goToLocationFromParams: (params: Record<string, string>) => {
      setPendingLocation(params);
    },
  });

  // Check for pending send data (e.g., from SoupChatInput) and send it
  const pendingSend = getPendingSend();
  if (pendingSend) {
    onSend({
      content: pendingSend.content,
      model: pendingSend.model ?? input.model(),
      attachments: pendingSend.attachments ?? [],
      toolset: { type: 'all' },
    });
  }

  registerScopeSignalHotkey(scopeId, {
    hotkey: 'enter',
    description: 'Focus Chat Input',
    keyDownHandler: () => {
      editor.controls.focus();
      return true;
    },
    hotkeyToken: TOKENS.block.focus,
    hide: true,
  });

  // Ctrl+C while AI is generating stops the stream.
  registerScopeSignalHotkey(scopeId, {
    hotkey: 'ctrl+c',
    description: 'Stop AI response',
    condition: () => chat.isGenerating(),
    keyDownHandler: () => {
      void onStop();
      return true;
    },
    hotkeyToken: TOKENS.chat.stop,
  });

  // J/K navigation focuses the block once it mounts, except when that block is
  // passive content in a Preview Pair Viewer.
  let hasRun = false;
  createEffect(() => {
    if (hasRun) return;
    if (!canAutofocusSplitContent) return;
    if (!blockElement()) return;
    if (!navigatedFromJK()) return;
    blockElement()?.focus();
    hasRun = true;
  });

  const isNestedBlock = useIsNestedBlock();

  return (
    <DragDropWrapper
      class="size-full overscroll-none overflow-hidden flex flex-col"
      isEntityDraggingOver={isDraggingOver}
    >
      <Show when={!isNestedBlock}>
        <Suspense>
          <TopBar
            showStreamDebug={showStreamDebug}
            toggleStreamDebug={() => setShowStreamDebug((p) => !p)}
          />
        </Suspense>
      </Show>
      <Show when={showStreamDebug()}>
        <div class="px-2 py-1 bg-surface border-b border-edge text-ink font-mono text-sm">
          <Show when={chat.stream()} fallback={<div>No active stream</div>}>
            {(stream) => (
              <div class="flex gap-x-4">
                <span>chunks: {stream().data().length}</span>
                <span>isDone: {String(stream().isDone())}</span>
              </div>
            )}
          </Show>
        </div>
      </Show>
      <div class="size-full flex-1 min-h-0 px-2 relative">
        <div class="absolute inset-0 pointer-events-none" use:droppable />
        <div
          data-chat-scroll
          class="h-full min-h-0 overflow-auto scrollbar-hidden"
          ref={setScrollRef}
        >
          <div class="mx-auto w-full max-w-3xl touch:pt-[calc(var(--mobile-content-inset-top,0)+0.5rem)] touch:pb-(--mobile-content-inset-bottom)">
            <ChatMessages
              editDisabled={disabled()}
              pendingLocationParams={pendingLocationParamsSignal.get}
            />
          </div>
        </div>
        <CustomScrollbar scrollContainer={scrollRef} />
      </div>
      <Show when={!disabled()}>
        <FloatRegionOrInline region="accessory">
          <div class="flex w-full justify-center pb-2 px-2 touch:pb-0 touch:px-(--mobile-chrome-gutter) touch:pointer-events-auto">
            <div class="w-3xl">
              <ChatInput
                editor={editor}
                initialValue={props.loadedInputText}
                onChange={setMarkdownText}
                chatId={chat.chatId()}
                onSend={onSend}
                onStop={onStop}
                autoFocusOnMount={
                  canAutofocusSplitContent && !navigatedFromJK()
                }
              />
            </div>
          </div>
        </FloatRegionOrInline>
      </Show>
    </DragDropWrapper>
  );
}
