import { useNavigatedFromJK } from '@app/component/useNavigatedFromJK';
import type { SendBuilder } from '@block-chat/blockClient';
import { TopBar } from '@block-chat/component/TopBar';
import type { ChatData } from '@block-chat/definition';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { useBuildChatSendRequest } from '@core/component/AI/component/input/buildRequest';
import { useChatInput } from '@core/component/AI/component/input/useChatInput';
import { useChatMessages } from '@core/component/AI/component/message';
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
import { usePaywallState } from '@core/constant/PaywallState';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { createMethodRegistration } from '@core/orchestrator';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { useCanEdit } from '@core/signal/permissions';
import { invalidateUserQuota } from '@service-auth/userQuota';
import { cognitionWebsocketServiceClient } from '@service-cognition/client';
import { createCallback } from '@solid-primitives/rootless';
import type { LexicalEditor } from 'lexical';
import { createEffect, createSignal, Show } from 'solid-js';
import { pendingLocationParamsSignal } from '../signal/pendingLocationParams';

export function Chat(props: { data: ChatData }) {
  const canEdit = useCanEdit();
  const disabled = () => !canEdit();
  const scopeId = blockHotkeyScopeSignal.get;
  const blockElement = blockElementSignal.get;
  const { navigatedFromJK } = useNavigatedFromJK();
  const [chatEditor, setChatEditor] = createSignal<LexicalEditor>();

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
  const {
    ChatMessages,
    addMessage,
    setStream: setMessagesStream,
  } = useChatMessages({
    messages: props.data.chat.messages,
    chatId: props.data.chat.id,
    editDisabled: disabled,
    pendingLocationParams: pendingLocationParamsSignal.get,
  });
  const blockHandle = blockHandleSignal.get;

  const loadedState = getChatInputStoredState(props.data.chat.id);

  const {
    ChatInput,
    setIsGenerating,
    attachments,
    chatMarkdownArea,
    model,
    setModel,
    uploadQueue,
  } = useChatInput({
    chatId: props.data.chat.id,
    initialValue: loadedState.input,
  });

  if (loadedState.attachments) {
    attachments.setAttached(loadedState.attachments);
  }
  if (loadedState.model) {
    setModel(loadedState.model);
  }

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
      addMessage({
        attachments: request.request.attachments ?? [],
        content: request.request.content,
        role: 'user',
        id: '',
      });
      const stream = request.call();
      setMessagesStream(stream);
      setStream(stream);
      setIsGenerating(true);
      invalidateUserQuota();
      createEffect(() => {
        if (stream.data().length > 0) {
          invalidateUserQuota();
        }
      });
      createEffect(() => {
        if (stream.isDone()) {
          setIsGenerating(false);
          invalidateUserQuota();
        }
      });
    }
  });

  const saveChatState = (state: StoredStuff) => {
    storeChatState(props.data.chat.id, state);
  };

  createEffect(() => {
    const input = chatMarkdownArea.markdownText();
    const attached = attachments.attached();
    const model_ = model();
    saveChatState({ attachments: attached, input, model: model_ });
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

  createEffect(() => {
    if (scopeId()) {
      registerHotkey({
        hotkey: 'enter',
        scopeId: scopeId(),
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
    }
  });

  createEffect(() => {
    if (!blockElement()) return;
    if (!navigatedFromJK()) return;
    blockElement()?.focus();
  });

  return (
    <DragDropWrapper
      class="size-full bg-panel overscroll-none overflow-hidden flex flex-col"
      uploadQueue={uploadQueue}
    >
      <TopBar />
      <div class="size-full flex-1 min-h-0 p-2">
        <div data-chat-scroll class="h-full min-h-0 overflow-auto">
          <div class="mx-auto w-full max-w-3xl">
            <ChatMessages />
          </div>
        </div>
      </div>
      <Show when={!disabled()}>
        <div class="flex w-full justify-center pb-2 px-4">
          <div class="w-3xl">
            <ChatInput
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
