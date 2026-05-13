import { useAnalytics } from '@app/component/analytics-context';
import { useMaybePreviewPanel } from '@app/component/PreviewPanel';
import { SplitToolbarLeft } from '@app/component/split-layout/components/SplitToolbar';
import { useNavigatedFromJK } from '@app/component/useNavigatedFromJK';
import type { SendBuilder } from '@block-chat/blockClient';
import { TopBar } from '@block-chat/component/TopBar';
import type { ChatData } from '@block-chat/definition';
import { pendingLocationParamsSignal } from '@block-chat/signal/pendingLocationParams';
import { useBlockId, useIsNestedBlock } from '@core/block';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { useSendChatMessage } from '@core/component/AI/component/input/buildRequest';
import { ChatMessages } from '@core/component/AI/component/message/ChatMessages';
import {
  ChatInputProvider,
  ChatProvider,
  useChatContext,
  useChatInputContext,
} from '@core/component/AI/context';
import { useEntityDropAttachment } from '@core/component/AI/hook/useEntityDropAttachment';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { getPendingSend } from '@core/component/AI/signal/pendingSend';
import { registerToolHandler } from '@core/component/AI/signal/tool';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import {
  getChatInputStoredState,
  type StoredStuff,
  storeChatState,
} from '@core/component/AI/util/storage';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
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
import ChatDebugIcon from '@icon/regular/chat-text.svg';
import { createRenameDssEntityMutation } from '@macro-entity';
import { invalidateUserQuota } from '@queries/auth';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { createCallback } from '@solid-primitives/rootless';
import { Button } from '@ui';
import { ChatInput } from 'core/component/AI/component/input/ChatInput';
import { createEffect, createSignal, getOwner, Show, Suspense } from 'solid-js';

export function Chat(props: { data: ChatData }) {
  const loadedState = getChatInputStoredState(props.data.chat.id);
  const { showPaywall } = usePaywallState();

  return (
    <ChatInputProvider
      initialAttachments={loadedState.attachments}
      model={loadedState.model}
    >
      <ChatProvider
        chatId={props.data.chat.id}
        messages={props.data.chat.messages}
        controllerOptions={{ onShowPaywall: showPaywall }}
      >
        <ChatInner data={props.data} loadedInputText={loadedState.input} />
      </ChatProvider>
    </ChatInputProvider>
  );
}

function ChatInner(props: {
  data: ChatData;
  loadedInputText: string | undefined;
}) {
  const owner = getOwner();
  const analytics = useAnalytics();
  const input = useChatInputContext();
  const chat = useChatContext();
  const canEdit = useCanEdit();
  const disabled = () => !canEdit();
  const scopeId = blockHotkeyScopeSignal.get;
  const blockElement = blockElementSignal.get;
  const { navigatedFromJK } = useNavigatedFromJK();
  const isPreview = !!useMaybePreviewPanel();
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const [showStreamDebug, setShowStreamDebug] = createSignal(false);
  const [markdownText, setMarkdownText] = createSignal(
    props.loadedInputText ?? ''
  );

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
    input.attachments
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

  // In preview mode, switching between Soup tabs was causing this createEffect to overflow the stack. We should figure out that root cause, this flag fixes it for now.
  let hasRun = false;
  createEffect(() => {
    if (hasRun) return;
    if (!blockElement()) return;
    if (!navigatedFromJK()) return;
    blockElement()?.focus();
    hasRun = true;
  });

  const isNestedBlock = useIsNestedBlock();

  return (
    <DragDropWrapper
      class="size-full bg-surface overscroll-none overflow-hidden flex flex-col"
      isEntityDraggingOver={isDraggingOver}
    >
      <Show when={!isNestedBlock}>
        <Suspense>
          <TopBar />
        </Suspense>
      </Show>
      <SplitToolbarLeft>
        <Show when={DEV_MODE_ENV}>
          <Button
            size="icon-sm"
            class="rounded-xs"
            onClick={() => setShowStreamDebug((p) => !p)}
            tooltip={
              showStreamDebug() ? 'Hide Stream Debug' : 'Show Stream Debug'
            }
          >
            <ChatDebugIcon />
            {/*{showStreamDebug() ? 'Hide' : 'Show'} Stream Debug*/}
          </Button>
        </Show>
      </SplitToolbarLeft>
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
          <div class="mx-auto w-full max-w-3xl">
            <ChatMessages
              editDisabled={disabled()}
              pendingLocationParams={pendingLocationParamsSignal.get}
            />
          </div>
        </div>
        <CustomScrollbar scrollContainer={scrollRef} />
      </div>
      <Show when={!disabled()}>
        <div class="flex w-full justify-center pb-2 px-4">
          <div class="w-3xl">
            <ChatInput
              editor={editor}
              initialValue={props.loadedInputText}
              onChange={setMarkdownText}
              chatId={chat.chatId()}
              onSend={onSend}
              onStop={onStop}
              autoFocusOnMount={!isPreview}
            />
          </div>
        </div>
      </Show>
    </DragDropWrapper>
  );
}
