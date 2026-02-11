import { useNavigatedFromJK } from '@app/component/useNavigatedFromJK';
import type { SendBuilder } from '@block-chat/blockClient';
import { TopBar } from '@block-chat/component/TopBar';
import type { ChatData } from '@block-chat/definition';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { useBuildChatSendRequest } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/useChatInput';
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
import type {
  CreateAndSend,
  MessageStream,
  Send,
} from '@core/component/AI/types';
import {
  getChatInputStoredState,
  type StoredStuff,
  storeChatState,
} from '@core/component/AI/util/storage';
import { useBlockId } from '@core/block';
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
import { invalidateUserQuota } from '@queries/auth';
import { cognitionWebsocketServiceClient } from '@service-cognition/client';
import { createCallback } from '@solid-primitives/rootless';
import type { LexicalEditor } from 'lexical';
import { createEffect, createSignal, Show } from 'solid-js';
import { pendingLocationParamsSignal } from '../signal/pendingLocationParams';

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

  const chatMarkdownArea = useChatMarkdownArea({
    initialValue: props.loadedInputText,
    addAttachment: (a) => input.attachments.addAttachment(a),
  });

  // Local stream signal for cancelStream and registerToolHandler
  const [stream, setStream] = createSignal<MessageStream>();
  const cancelStream = () => {
    const s = stream();
    if (s) {
      cognitionWebsocketServiceClient.stopChatMessage({
        stream_id: s.request.stream_id,
      });
      s.close();
    }
  };

  const blockHandle = blockHandleSignal.get;

  // Entity drag-and-drop support
  const chatId = useBlockId();
  const { droppable, isDraggingOver } = useEntityDropAttachment(
    'chat-input-' + chatId,
    input.attachments
  );
  false && droppable;

  registerToolHandler(stream);
  const { showPaywall } = usePaywallState();

  const onSend = createCallback(async (request: Send | CreateAndSend) => {
    if (request.type === 'createAndSend') {
      const response = await request.call();
      if ('type' in response && response.type === 'error') {
        if (response.paymentError) showPaywall();
        return;
      } else {
        return onSend(response);
      }
    } else {
      chat.addMessage({
        attachments: request.request.attachments ?? [],
        content: request.request.content,
        role: 'user',
        id: '',
      });
      const stream = request.call();
      chat.setStream(stream);
      setStream(stream);
      input.setIsGenerating(true);
      invalidateUserQuota();
      createEffect(() => {
        if (stream.data().length > 0) {
          invalidateUserQuota();
        }
      });
      createEffect(() => {
        if (stream.isDone()) {
          input.setIsGenerating(false);
          invalidateUserQuota();
        }
      });
    }
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
  const buildChatSendRequest = useBuildChatSendRequest();

  createMethodRegistration(blockHandle, {
    sendMessage: async (sendRequest: SendBuilder) => {
      const send = await buildChatSendRequest(sendRequest);
      onSend(send);
    },
    goToLocationFromParams: (params: Record<string, string>) => {
      setPendingLocation(params);
    },
  });

  // Check for pending send data (e.g., from SoupChatInput) and send it
  const pendingSend = getPendingSend();
  if (pendingSend) {
    buildChatSendRequest({
      chatId: props.data.chat.id,
      userRequest: pendingSend.content,
      attachments: pendingSend.attachments,
      model: pendingSend.model,
      isPersistent: true,
    }).then((request) => onSend(request));
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
              onStop={cancelStream}
              captureEditor={setChatEditor}
              autoFocusOnMount={!navigatedFromJK()}
            />
          </div>
        </div>
      </Show>
    </DragDropWrapper>
  );
}
