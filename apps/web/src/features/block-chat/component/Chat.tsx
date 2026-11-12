import { openChatWithAgent } from '@app/features/chat/ChatWithAgentButton';
import { TopBar } from '@block-chat/component/TopBar';
import { type ChatData, DEFAULT_CHAT_NAME } from '@block-chat/definition';
import { pendingLocationParamsSignal } from '@block-chat/signal/pendingLocationParams';
import { FloatRegionOrInline } from '@components/app/mobile/float-regions/FloatRegion';
import { useCanAutofocusSplitContent } from '@components/app/split-layout/layoutUtils';
import { useNavigatedFromJK } from '@components/app/useNavigatedFromJK';
import { useIsNestedBlock } from '@core/block';
import { ChatMessages } from '@core/component/AI/component/message/ChatMessages';
import { ChatProvider, useChatContext } from '@core/component/AI/context';
import { registerToolHandler } from '@core/component/AI/signal/tool';
import { resolveChatInputModel } from '@core/component/AI/util/parse';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { TOKENS } from '@core/hotkey/tokens';
import { registerScopeSignalHotkey } from '@core/hotkey/utils';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createMethodRegistration } from '@core/orchestrator';
import {
  blockElementSignal,
  blockHotkeyScopeSignal,
} from '@core/signal/blockElement';
import { blockHandleSignal } from '@core/signal/load';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { fireAndForget } from '@core/util/fireAndForget';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { Button } from '@ui';
import { createEffect, createSignal, Show, Suspense } from 'solid-js';

/**
 * A legacy AI chat, read-only: its history renders and a response already
 * streaming can be stopped, but nothing new is sent. New conversations are
 * agent sessions, and "Continue in Agents" starts one that mentions this
 * chat.
 */
export function Chat(props: { data: ChatData }) {
  return (
    <ChatProvider
      chatId={props.data.chat.id}
      messages={props.data.chat.messages}
    >
      <ChatInner data={props.data} />
    </ChatProvider>
  );
}

function ChatInner(props: { data: ChatData }) {
  const chat = useChatContext();
  const name = useBlockDocumentName(DEFAULT_CHAT_NAME);
  const scopeId = blockHotkeyScopeSignal.get;
  const blockElement = blockElementSignal.get;
  const { navigatedFromJK } = useNavigatedFromJK();
  const canAutofocusSplitContent = useCanAutofocusSplitContent();
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const [showStreamDebug, setShowStreamDebug] = createSignal(false);
  const [opening, setOpening] = createSignal(false);

  registerToolHandler(() => {
    const s = chat.stream();
    if (!s) return undefined;
    return { data: s.data };
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

  const continueInAgent = async () => {
    if (opening()) return;
    setOpening(true);
    try {
      await openChatWithAgent({
        type: 'chat',
        id: chat.chatId(),
        name: name() ?? DEFAULT_CHAT_NAME,
      });
    } finally {
      setOpening(false);
    }
  };

  createMethodRegistration(blockHandleSignal.get, {
    goToLocationFromParams: (params: Record<string, string>) => {
      pendingLocationParamsSignal.set(params);
    },
  });

  // Ctrl+C while AI is generating stops the stream.
  registerScopeSignalHotkey(scopeId, {
    hotkey: 'ctrl+c',
    description: 'Stop AI response',
    condition: () => chat.isGenerating(),
    keyDownHandler: () => {
      fireAndForget(onStop(), 'chat-stop');
      return true;
    },
    hotkeyToken: TOKENS.chat.stop,
  });

  // J/K navigation focuses mounted standalone blocks.
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
    <div class="size-full overscroll-none overflow-hidden flex flex-col">
      <Show when={!isNestedBlock}>
        <Suspense>
          <TopBar
            model={resolveChatInputModel(props.data.chat.model)}
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
        <div
          data-chat-scroll
          class="h-full min-h-0 overflow-auto scrollbar-hidden"
          ref={setScrollRef}
        >
          <div class="mx-auto w-full max-w-3xl touch:pt-[calc(var(--mobile-content-inset-top,0)+0.5rem)] touch:pb-(--mobile-content-inset-bottom)">
            <ChatMessages
              editDisabled
              pendingLocationParams={pendingLocationParamsSignal.get}
            />
          </div>
        </div>
        <CustomScrollbar scrollContainer={scrollRef} />
      </div>
      <FloatRegionOrInline region="accessory">
        <div
          class="mx-auto w-full max-w-3xl shrink-0 px-4 pb-3 pointer-events-auto touch:px-(--mobile-chrome-gutter) touch:pb-0"
          data-holds-prompts={isTouchDevice() ? undefined : ''}
        >
          <div
            role="status"
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-edge-muted bg-surface px-4 py-3 text-sm text-ink-muted"
          >
            <div class="min-w-0">
              <p class="font-medium text-ink">Macro Chats are now Agents.</p>
              <p>
                This chat is read-only. Continue it in Agents to keep going.
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <Show when={chat.isGenerating()}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fireAndForget(onStop(), 'chat-stop')}
                >
                  Stop
                </Button>
              </Show>
              <Button
                variant="primary"
                size="sm"
                disabled={opening()}
                onClick={() =>
                  fireAndForget(continueInAgent(), 'chat-continue-in-agent')
                }
              >
                Continue in Agents
              </Button>
            </div>
          </div>
        </div>
      </FloatRegionOrInline>
    </div>
  );
}
