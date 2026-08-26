import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import { buildChatEditor } from '@core/component/AI/component/input/buildChatEditor';
import type { ChatSendInput } from '@core/component/AI/component/input/buildRequest';
import { useSendChatMessage } from '@core/component/AI/component/input/buildRequest';
import { ChatInput } from '@core/component/AI/component/input/ChatInput';
import { AssistantMessage } from '@core/component/AI/component/message/AssistantMessage';
import { UserMessage } from '@core/component/AI/component/message/UserMessage';
import {
  ChatInputProvider,
  ChatProvider,
  useChatContext,
  useChatInputContext,
} from '@core/component/AI/context';
import { useGetChatAttachmentInfo } from '@core/component/AI/signal/attachment';
import { toast } from '@core/component/Toast/Toast';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import { asChatMessage } from '@core/component/AI/util/message';
import { MACRO_AGENT_NAME } from '@core/constant/macroAgent';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { createChat } from '@core/util/create';
import { isPaymentError } from '@core/util/handlePaymentError';
import { createRenameDssEntityMutation } from '@entity';
import { PulsingStar } from '@entity/components/PulsingStar';
import LogoIcon from '@icon/macro-logo.svg';
import { createCallback } from '@solid-primitives/rootless';
import ExpandIcon from '@phosphor/arrows-out-simple.svg';
import CircleNotchIcon from '@phosphor/circle-notch.svg';
import MinusIcon from '@phosphor/minus.svg';
import PlusIcon from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
import { invalidateUserQuota } from '@queries/auth';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { connectionGatewayClient } from '@service-connection/client';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  getOwner,
  Match,
  onCleanup,
  Show,
  Switch,
} from 'solid-js';
import { mockAgentLoading } from './experimental-debug-state';

const QuickAgentEmptyState = () => (
  <div class="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 px-6 py-8 text-center text-ink-extra-muted">
    <LogoIcon class="size-6 text-ink/20" />
    <div class="space-y-1">
      <div class="text-sm font-medium text-ink/55">Ask Macro anything</div>
      <div class="text-xs leading-relaxed">
        Start with a question, mention work, or ask for help across Macro.
      </div>
    </div>
  </div>
);

function createQuickAgentEditor() {
  const analytics = useAnalytics();
  const input = useChatInputContext();
  const { getAttachmentFromMention } = useGetChatAttachmentInfo();

  return buildChatEditor().withMentions({
    onCreate: (mention) => {
      analytics.track('mentions_menu_use', { itemType: 'chat' });
      const attachment = getAttachmentFromMention(mention);
      if (attachment) input.attachments.addAttachment(attachment);
    },
    block: 'chat',
    showOpenTabs: true,
  });
}

function QuickAgentComposer(props: {
  onMinimize: () => void;
  onSend: (request: ChatSendInput) => Promise<void> | void;
  chatId?: string;
  onStop?: () => Promise<void> | void;
}) {
  const editor = createQuickAgentEditor();

  return (
    <ChatInput
      editor={editor}
      chatId={props.chatId}
      onSend={props.onSend}
      onStop={props.onStop}
      onEscape={() => {
        props.onMinimize();
        return true;
      }}
      isPersistent
      autoFocusOnMount
    />
  );
}

function QuickAgentChatWithProvider(props: {
  chatId: string;
  initialRequest?: ChatSendInput;
  onInitialRequestSent: () => void;
  onMinimize: () => void;
  onGeneratingChange: (generating: boolean) => void;
}) {
  const owner = getOwner();
  const input = useChatInputContext();
  const chat = useChatContext();
  const sendChatMessage = useSendChatMessage();
  const renameMutation = createRenameDssEntityMutation();

  createEffect(() => {
    const generating = chat.isGenerating();
    input.setIsGenerating(generating);
    props.onGeneratingChange(chat.isWaiting() || generating);
    if (generating) invalidateUserQuota();
  });

  onCleanup(() => props.onGeneratingChange(false));

  createEffect(() => {
    connectionGatewayClient.trackEntity({
      entity_type: 'chat',
      entity_id: props.chatId,
      action: 'open',
    });
    onCleanup(() => {
      connectionGatewayClient.trackEntity({
        entity_type: 'chat',
        entity_id: props.chatId,
        action: 'close',
      });
    });
  });

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

    const result = await sendChatMessage({ ...request, chatId: chat.chatId() });
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

  createEffect(() => {
    const request = props.initialRequest;
    if (!request) return;
    props.onInitialRequestSent();
    void onSend(request);
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

  const generatingMessage = createMemo(() => {
    const stream = chat.stream();
    if (!stream || stream.isDone()) return;
    return asChatMessage(stream.data());
  });

  return (
    <>
      <div class="scrollbar-hidden min-h-0 flex-1 overflow-auto px-1 py-2">
        <Show
          when={chat.messages().length > 0 || chat.stream()}
          fallback={<QuickAgentEmptyState />}
        >
          <div class="flex flex-col gap-4 text-sm">
            <For each={chat.messages()}>
              {(message) => (
                <Switch>
                  <Match when={message.role === 'user'}>
                    <UserMessage message={message} />
                  </Match>
                  <Match when={message.role === 'assistant'}>
                    <AssistantMessage message={message} />
                  </Match>
                </Switch>
              )}
            </For>
            <Show
              when={generatingMessage()}
              fallback={
                <Show when={chat.isWaiting() || chat.isGenerating()}>
                  <div class="flex items-center gap-2 px-2 py-1 text-xs text-ink-extra-muted">
                    <PulsingStar kind="streamIndicator" animate />
                    <span>Macro is thinking…</span>
                  </div>
                </Show>
              }
            >
              {(message) => (
                <AssistantMessage message={message()} isStreaming />
              )}
            </Show>
          </div>
        </Show>
      </div>
      <div class="shrink-0">
        <QuickAgentComposer
          chatId={props.chatId}
          onMinimize={props.onMinimize}
          onSend={onSend}
          onStop={onStop}
        />
      </div>
    </>
  );
}

function QuickAgentInlineChat(props: {
  onMinimize: () => void;
  onChatIdChange: (chatId: string | undefined) => void;
  onGeneratingChange: (generating: boolean) => void;
  resetKey: number;
}) {
  const [chatId, setChatId] = createSignal<string>();
  const [initialRequest, setInitialRequest] = createSignal<ChatSendInput>();
  const { showPaywall } = usePaywallState();

  createEffect(() => {
    props.resetKey;
    setChatId(undefined);
    setInitialRequest(undefined);
    props.onChatIdChange(undefined);
  });

  const createInlineChat = async (request: ChatSendInput) => {
    const response = await cognitionApiServiceClient.createChat({});
    if (response.isErr()) {
      if (isPaymentError(response)) showPaywall(PaywallKey.CHAT_LIMIT);
      return;
    }
    setInitialRequest(request);
    setChatId(response.value.id);
    props.onChatIdChange(response.value.id);
  };

  return (
    <ChatInputProvider>
      <div class="flex h-[28rem] max-h-[calc(100vh-5rem)] min-h-0 flex-col">
        <Show
          when={chatId()}
          fallback={
            <>
              <QuickAgentEmptyState />
              <div class="shrink-0">
                <QuickAgentComposer
                  onMinimize={props.onMinimize}
                  onSend={createInlineChat}
                />
              </div>
            </>
          }
        >
          {(id) => (
            <ChatProvider
              chatId={id()}
              messages={[]}
              controllerOptions={{ onShowPaywall: showPaywall }}
            >
              <QuickAgentChatWithProvider
                chatId={id()}
                initialRequest={initialRequest()}
                onInitialRequestSent={() => setInitialRequest(undefined)}
                onMinimize={props.onMinimize}
                onGeneratingChange={props.onGeneratingChange}
              />
            </ChatProvider>
          )}
        </Show>
      </div>
    </ChatInputProvider>
  );
}

/** Persistent inline agent-chat content rendered inside the v6 popover. */
export function ExperimentalQuickAgentChat(props: {
  onClose: () => void;
  onMinimize: () => void;
  onGeneratingChange: (generating: boolean) => void;
}) {
  const [inlineChatId, setInlineChatId] = createSignal<string>();
  const [chatKey, setChatKey] = createSignal(1);

  const startNewChat = () => {
    setInlineChatId(undefined);
    setChatKey((key) => key + 1);
  };

  const expandToSplit = async () => {
    let chatId = inlineChatId();
    if (!chatId) {
      const result = await createChat();
      if ('error' in result || !result.chatId) {
        toast.failure('Unable to start chat');
        return;
      }
      chatId = result.chatId;
      setInlineChatId(chatId);
    }

    globalSplitManager()?.openWithSplit(
      { type: 'chat', id: chatId },
      { activate: true, preferNewSplit: true }
    );
    props.onClose();
  };

  return (
    <div class="box-border w-[26rem] max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-edge-muted bg-menu p-2 shadow-menu">
      <div class="mb-1 flex items-center justify-between px-1.5 text-xs text-ink/45">
        <div class="flex min-w-0 items-center gap-1.5">
          <span class="flex items-center gap-1.5 font-medium">
            <LogoIcon class="size-3 text-accent" />
            Ask {MACRO_AGENT_NAME}
          </span>
          <Show when={inlineChatId()}>
            <button
              type="button"
              class="inline-flex h-5 items-center gap-1 rounded-md bg-ink/6 px-1.5 text-[11px] font-medium text-ink/65 transition-colors hover:bg-ink/10 hover:text-ink"
              onClick={startNewChat}
              aria-label="New Macro chat"
            >
              <PlusIcon class="size-3" />
              <span>New</span>
            </button>
          </Show>
        </div>
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            class="rounded-md p-1 text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
            onClick={props.onMinimize}
            aria-label="Minimize Macro chat"
          >
            <MinusIcon class="size-3.5" />
          </button>
          <button
            type="button"
            class="rounded-md p-1 text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
            onClick={expandToSplit}
            aria-label="Open Macro chat in split"
          >
            <ExpandIcon class="size-3.5" />
          </button>
          <button
            type="button"
            class="rounded-md p-1 text-ink/45 transition-colors hover:bg-ink/5 hover:text-ink"
            onClick={props.onClose}
            aria-label="Close Macro chat"
          >
            <XIcon class="size-3.5" />
          </button>
        </div>
      </div>
      <div class="relative w-full min-w-0 max-w-full overflow-hidden [&_.ui-surface]:h-auto [&_.ui-surface]:max-w-full [&_.ui-surface]:min-w-0 [&_.ui-surface]:w-full [&_#chat-input]:max-w-full [&_#chat-input]:min-w-0 [&_#chat-input-text-area]:min-w-0">
        <QuickAgentInlineChat
          onMinimize={props.onMinimize}
          onChatIdChange={setInlineChatId}
          onGeneratingChange={props.onGeneratingChange}
          resetKey={chatKey()}
        />
        <Show when={mockAgentLoading()}>
          <div class="absolute inset-0 flex items-center justify-center gap-2 bg-menu/90 text-sm text-ink-muted backdrop-blur-sm">
            <CircleNotchIcon class="size-5 animate-spin" />
            <span>Loading agent…</span>
          </div>
        </Show>
      </div>
    </div>
  );
}
