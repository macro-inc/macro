import { useNavigatedFromJK } from '@app/component/useNavigatedFromJK';
import type { SendBuilder } from '@block-chat/blockClient';
import { TopBar } from '@block-chat/component/TopBar';
import type { ChatData } from '@block-chat/definition';
import { pendingLocationParamsSignal } from '@block-chat/signal/pendingLocationParams';
import { useBlockId } from '@core/block';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { useSendChatMessage } from '@core/component/AI/component/input/buildRequest';
import { useChatMarkdownArea } from '@core/component/AI/component/input/useChatMarkdownArea';
import { ChatMessages } from '@core/component/AI/component/message/ChatMessages';
import {
  ChatInputProvider,
  ChatProvider,
  useChatContext,
  useChatInputContext,
} from '@core/component/AI/context';
import { useEntityDropAttachment } from '@core/component/AI/hook/useEntityDropAttachment';
import { getPendingSend } from '@core/component/AI/signal/pendingSend';
import { registerToolHandler } from '@core/component/AI/signal/tool';
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
import { invalidateUserQuota } from '@queries/auth';
import { createCallback } from '@solid-primitives/rootless';
import { ChatInput } from 'core/component/AI/component/input/ChatInput';
import type { LexicalEditor } from 'lexical';
import { createEffect, createSignal, Show } from 'solid-js';

export function Chat(props: { data: ChatData }) {
  const loadedState = getChatInputStoredState(props.data.chat.id);

  return (
    <ChatInputProvider
      initialAttachments={loadedState.attachments}
      model={loadedState.model}
    >
      <ChatProvider
        chatId={props.data.chat.id}
        messages={props.data.chat.messages}
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
  const input = useChatInputContext();
  const chat = useChatContext();
  const canEdit = useCanEdit();
  const disabled = () => !canEdit();
  const scopeId = blockHotkeyScopeSignal.get;
  const blockElement = blockElementSignal.get;
  const { navigatedFromJK } = useNavigatedFromJK();
  const [chatEditor, setChatEditor] = createSignal<LexicalEditor>();
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const [showStreamDebug, setShowStreamDebug] = createSignal(false);
  const chatMarkdownArea = useChatMarkdownArea({
    initialValue: props.loadedInputText,
    addAttachment: (a) => input.attachments.addAttachment(a),
  });

  // Local stream signal for registerToolHandler

  createEffect(() => {
    const chatStream = chat.stream();
    if (!chatStream || chatStream.isDone()) {
      input.setIsGenerating(false);
      return;
    }
    input.setIsGenerating(true);
    if (chatStream.data().length > 0) invalidateUserQuota();
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
  const { showPaywall } = usePaywallState();

  const sendChatMessage = useSendChatMessage();

  const onSend = createCallback(async (request: ChatSendInput) => {
    chat.addMessage({
      id: crypto.randomUUID(),
      content: request.content,
      role: 'user',
      attachments: request.attachments ?? [],
    });
    chat.setWaitingForStream(true);

    const result = await sendChatMessage({
      ...request,
      chatId: chat.chatId(),
    });

    chat.setWaitingForStream(false);

    if ('error' in result) {
      if (result.paymentError) showPaywall();
      return;
    }

    chat.setStream(result.stream);
    input.setIsGenerating(true);
    invalidateUserQuota();
  });

  const saveChatState = (state: StoredStuff) => {
    storeChatState(props.data.chat.id, state);
  };

  createEffect(() => {
    const inputText = chatMarkdownArea.markdownText();
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
      const editor = chatEditor();
      if (editor) {
        editor.focus(undefined, { defaultSelection: 'rootStart' });
        return true;
      }
      return false;
    },
    hotkeyToken: TOKENS.block.focus,
    hide: true,
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

  return (
    <DragDropWrapper
      class="size-full bg-panel overscroll-none overflow-hidden flex flex-col"
      isEntityDraggingOver={isDraggingOver}
    >
      <TopBar />
      <Show when={DEV_MODE_ENV}>
        <button
          class="text-xs px-2 py-0.5 text-secondary hover:text-ink"
          onClick={() => setShowStreamDebug((p) => !p)}
        >
          {showStreamDebug() ? 'Hide' : 'Show'} Stream Debug
        </button>
      </Show>
      <Show when={showStreamDebug()}>
        <div class="px-2 py-1 bg-menu border-b border-edge text-ink font-mono text-sm">
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
      <div class="size-full flex-1 min-h-0 p-2 relative">
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
              markdown={chatMarkdownArea}
              chatId={chat.chatId()}
              onSend={onSend}
              captureEditor={setChatEditor}
              autoFocusOnMount={!navigatedFromJK()}
            />
          </div>
        </div>
      </Show>
    </DragDropWrapper>
  );
}
