import { globalSplitManager } from '@app/signal/splitLayout';
import { useIsAuthenticated } from '@core/auth';
import { AiChatEmptyState } from '@core/component/AI/component/AIChatEmptyState';
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
import type {
  Attachment,
  ChatMessageStream,
  ChatMessageWithAttachments,
  Model,
} from '@core/component/AI/types';
import { parseModel } from '@core/component/AI/util';
import {
  getChatInputStoredState,
  storeChatState,
} from '@core/component/AI/util/storage';
import { CustomScrollbar } from '@core/component/CustomScrollbar';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { Hotkey } from '@core/component/Hotkey';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { ReferencesModal } from '@core/component/ReferencesModal';
import { Resize } from '@core/component/Resize';
import type { Permissions } from '@core/component/SharePermissions';
import { getPermissions } from '@core/component/SharePermissions';
import { ShareButton } from '@core/component/TopBar/ShareButton';
import { ENABLE_REFERENCES_MODAL } from '@core/constant/featureFlags';
import { usePaywallState } from '@core/constant/PaywallState';
import { settingsOpen } from '@core/constant/SettingsState';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import {
  isRightPanelOpen,
  useBigChat,
  useToggleRightPanel,
} from '@core/signal/layout';
import { rightbarChatId, setRightbarChatId } from '@core/signal/rightbar';
import { isErr } from '@core/util/maybeResult';
import ContractIcon from '@icon/regular/arrows-in.svg';
import ExpandIcon from '@icon/regular/arrows-out.svg';
import ChatIcon from '@icon/regular/chat.svg';
import HistoryIcon from '@icon/regular/clock-counter-clockwise.svg';
import NotepadIcon from '@icon/regular/notepad.svg';
import PlusIcon from '@icon/regular/plus.svg';
import XIcon from '@icon/regular/x.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { invalidateUserQuota } from '@queries/auth';
import { refetchHistory, useHistoryQuery } from '@queries/history/history';
import { cognitionApiServiceClient } from '@service-cognition/client';
import { AccessLevel } from '@service-cognition/generated/schemas/accessLevel';
import { connectionGatewayClient } from '@service-connection/client';
import { state as connectionState } from '@service-connection/websocket';
import { Button } from '@ui/components/Button';
import { WebsocketConnectionState } from '@websocket';
import { ChatInput } from 'core/component/AI/component/input/ChatInput';
import { useOpenInstructionsMd } from 'core/component/AI/util/instructions';
import type { LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSXElement,
  on,
  onCleanup,
  type Setter,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { useWaitChatRename } from '@macro-entity';
import { SplitlikeContainer } from '../split-layout/components/SplitContainer';

type ChatData = {
  messages: ChatMessageWithAttachments[];
  name: string | undefined;
  model: Model | undefined;
  attachments: Attachment[];
  userAccessLevel?: AccessLevel;
};

const getChatData = async (chatId: string): Promise<ChatData> => {
  if (!chatId)
    return { messages: [], name: undefined, model: undefined, attachments: [] };

  const res = await cognitionApiServiceClient.getChat({ chat_id: chatId });
  // TODO: show error state
  if (isErr(res, 'UNAUTHORIZED')) {
    throw new Error('Unauthorized to fetch chat');
  }
  if (isErr(res)) {
    throw new Error('Failed to fetch chat');
  }

  const [, chat] = res;
  const messages = chat.chat.messages;
  const name = chat.chat.name;

  let model: Model | undefined;
  let attachments: Attachment[] = [];

  const { model: localModel, attachments: localAttachments } =
    getChatInputStoredState(chatId);

  model = localModel ?? parseModel(chat.chat.model);

  attachments =
    localAttachments ??
    new Map(chat.chat.attachments.map((a) => [a.attachmentId, a]))
      .values()
      .toArray();

  return {
    messages,
    name,
    model,
    attachments,
    userAccessLevel: chat.userAccessLevel as AccessLevel,
  };
};

const usePersistentChats = () => {
  const historyQuery = useHistoryQuery();
  return createMemo(() =>
    (historyQuery.data ?? []).filter(
      (item) => item.type === 'chat' && item.isPersistent
    )
  );
};

const PersistentChatList = (props: { onSelect: (chatId: string) => void }) => {
  const persistentChats = usePersistentChats();
  return (
    <DropdownMenuContent class="z-modal w-60 h-120 overflow-y-auto">
      <For each={persistentChats()}>
        {(chat) => (
          <MenuItem
            text={chat.name}
            icon={ChatIcon}
            onClick={() => props.onSelect(chat.id)}
          />
        )}
      </For>
    </DropdownMenuContent>
  );
};

// Trigger button component for the persistent chat list
export const PersistentChatHistoryButton = (props: {
  setChatId: (chatId: string | undefined) => void;
}) => {
  const [showMenu, setShowMenu] = createSignal(false);

  const onSelect = (chatId: string) => {
    props.setChatId(chatId);
    setShowMenu(false);
  };

  return (
    <DropdownMenu open={showMenu()} onOpenChange={setShowMenu}>
      <DropdownMenu.Trigger>
        <DeprecatedIconButton
          size="sm"
          icon={HistoryIcon}
          theme="current"
          tooltip={{ label: 'Toggle recent threads' }}
          onDeepClick={() => setShowMenu((prev) => !prev)}
        />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <PersistentChatList onSelect={onSelect} />
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
};

function TopBar(props: {
  chatId: string | undefined;
  setChatId: (chatId: string | undefined) => void;
  chatName?: string;
  userPermissions: Accessor<Permissions>;
}) {
  const createNewRightbarChat = () => {
    props.setChatId(undefined);
  };
  const openInstructions = useOpenInstructionsMd();
  const [bigChatOpen, setBigChatOpen] = useBigChat();
  const toggleRightPanel = useToggleRightPanel();

  return (
    <div
      class="h-10 border-b border-edge-muted flex items-center w-full px-2 shrink-0 grow-0"
      data-split-panel
    >
      <Button
        tooltip="Close Assistant Panel"
        class="p-1 size-6"
        onClick={() => {
          if (bigChatOpen()) {
            setBigChatOpen(false);
          } else {
            toggleRightPanel();
          }
        }}
      >
        <XIcon />
      </Button>
      <Button
        tooltip={
          <div class="flex flex-row gap-x-1">
            <div>Create New Chat</div>
            <div class="flex border border-edge-muted text-[0.625rem] rounded-xs items-center px-1.5 py-0.25 font-normal">
              <Hotkey shortcut="ctrl+t" />
            </div>
          </div>
        }
        class="p-1 size-6"
        onClick={createNewRightbarChat}
      >
        <PlusIcon />
      </Button>
      <div class="grow" />
      <div class="flex items-center gap-1">
        <Show when={ENABLE_REFERENCES_MODAL && props.chatId}>
          <ReferencesModal
            documentId={props.chatId!}
            documentName={props.chatName ?? 'New Chat'}
            entityType="chat"
          />
        </Show>
        <Show when={props.chatId}>
          <ShareButton
            id={props.chatId!}
            name={props.chatName ?? 'New Chat'}
            userPermissions={props.userPermissions()}
            itemType="chat"
          />
        </Show>
        <DeprecatedIconButton
          size="sm"
          icon={NotepadIcon}
          tooltip={{ label: 'Edit AI Instructions' }}
          theme="current"
          onClick={() => {
            openInstructions();
          }}
        />
        <PersistentChatHistoryButton setChatId={props.setChatId} />
        <DeprecatedIconButton
          size="sm"
          icon={bigChatOpen() ? ContractIcon : ExpandIcon}
          tooltip={{
            label: bigChatOpen()
              ? 'Minimize Assistant Panel'
              : 'Spotlight Assistant Panel',
            hotkeyToken: TOKENS.global.toggleBigChat,
          }}
          theme="current"
          onClick={() => {
            setBigChatOpen((v) => !v);
          }}
        />
      </div>
    </div>
  );
}

/** Renders messages + stream effects. Only mounted inside ChatProvider. */
function RightbarChatArea(props: { isBig?: boolean }) {
  const chat = useChatContext();
  const input = useChatInputContext();
  const [messagesContainerRef, setMessagesContainerRef] =
    createSignal<HTMLElement>();

  createEffect(() => {
    const stream_ = chat.stream();
    if (stream_ && stream_.data().length > 0) {
      invalidateUserQuota();
    }
  });

  createEffect(() => {
    const stream_ = chat.stream();
    if (!stream_ || stream_.isDone()) {
      input.setIsGenerating(false);
      if (stream_?.isDone()) {
        invalidateUserQuota();
      }
      return;
    } else {
      input.setIsGenerating(true);
    }
  });

  registerToolHandler(() => {
    const s = chat.stream();
    if (!s) return undefined;
    return { data: s.data };
  });

  return (
    <>
      <Show when={chat.messages().length === 0}>
        <div class="h-full flex flex-col items-center justify-center">
          <AiChatEmptyState />
        </div>
      </Show>
      <Show when={chat.messages().length > 0 || !props.isBig}>
        <div class="relative flex-1 min-h-0 w-full">
          <div
            data-chat-scroll
            class="size-full overflow-y-auto overflow-x-hidden scroll-smooth flex justify-center scrollbar-hidden"
            ref={setMessagesContainerRef}
          >
            <div class="w-full macro-message-width macro-message-padding">
              <ChatMessages messageActions={undefined} />
            </div>
          </div>
          <CustomScrollbar scrollContainer={messagesContainerRef} />
        </div>
      </Show>
    </>
  );
}

export function Rightbar(props: {
  chatId: string | undefined;
  onSend: (args: ChatSendInput) => void;
  chatName: string | undefined;
  isBig?: boolean;
  userPermissions: Accessor<Permissions>;
  onUnmount?: () => void;
  initialState?: {
    model: Model | undefined;
    attachments: Attachment[];
    text: string | undefined;
  };
  setState: {
    setChatId: (chatId: string | undefined) => void;
    setModel: Setter<Model | undefined>;
    setAttachments: Setter<Attachment[]>;
    setText: Setter<string | undefined>;
  };
  children?: JSXElement;
}) {
  const input = useChatInputContext();

  // NOTE: due to mount race condition in the markdown area, we need to set the initial value here
  const chatMarkdownArea = useChatMarkdownArea({
    initialValue: props.initialState?.text,
    addAttachment: (a) => input.attachments.addAttachment(a),
  });

  // Entity drag-and-drop support
  const { droppable, isDraggingOver } = useEntityDropAttachment(
    'rightbar-chat-input',
    input.attachments
  );
  false && droppable;

  createEffect(() => {
    if (!props.initialState) return;
    input.setModel(props.initialState.model);
    input.attachments.setAttached(props.initialState.attachments);
  });

  onCleanup(() => {
    props.onUnmount?.();
  });

  createEffect(() => {
    const inputText = chatMarkdownArea.markdownText();
    const attached = input.attachments.attached();
    const model_ = input.model();
    props.setState.setText(inputText);
    props.setState.setAttachments(attached);
    props.setState.setModel(model_);
  });

  const [editor, setEditor] = createSignal<LexicalEditor>();
  let borrowedFocus: Element | null = null;
  const returnFocus = () => {
    if (
      borrowedFocus &&
      borrowedFocus.isConnected &&
      borrowedFocus instanceof HTMLElement
    ) {
      borrowedFocus.focus();
    } else {
      globalSplitManager()?.returnFocus();
    }
  };

  // Defering these effects so that they don't trigger on first load
  createEffect(
    on(
      () => props.isBig,
      (isBig) => {
        if (isBig) {
          borrowedFocus = document.activeElement;
          editor()?.focus();
        } else {
          if (untrack(isRightPanelOpen)) {
            return;
          } else {
            returnFocus();
          }
        }
      },
      { defer: true }
    )
  );

  createEffect(
    on(
      isRightPanelOpen,
      (isOpen) => {
        if (isOpen) {
          borrowedFocus = document.activeElement;
          editor()?.focus();
        } else {
          returnFocus();
        }
      },
      { defer: true }
    )
  );

  return (
    <DragDropWrapper
      class="relative flex flex-col size-full select-none"
      isEntityDraggingOver={isDraggingOver}
    >
      <div class="overflow-hidden size-full flex flex-col items-center relative">
        <div class="absolute inset-0 pointer-events-none" use:droppable />
        <TopBar
          chatId={props.chatId}
          setChatId={props.setState.setChatId}
          chatName={props.chatName}
          userPermissions={props.userPermissions}
        />
        <div class="flex flex-col flex-1 min-h-0 p-2 w-full items-center">
          {props.children}

          <div class="w-full">
            <div class="flex-shrink-0 pt-2 macro-message-width macro-message-padding mx-auto">
              <ChatInput
                markdown={chatMarkdownArea}
                chatId={props.chatId}
                isPersistent
                showActiveTabs
                onSend={props.onSend}
                captureEditor={setEditor}
              />
            </div>
          </div>
        </div>
      </div>
    </DragDropWrapper>
  );
}

/** Owns rightbar chat state to prevent data loss on panel close */
export const RightbarWrapper = (_props: { isBigChat?: boolean }) => {
  const [bigChatOpen, setBigChatOpen] = useBigChat();
  const isAuthenticated = useIsAuthenticated();
  const [text, setText] = createSignal<string>();
  const [chatName, setChatName] = createSignal<string | undefined>();
  const [chatId, setChatId] = [rightbarChatId, setRightbarChatId];
  const [newChatId, setNewChatId] = createSignal<string | undefined>();
  const [messages, setMessages] = createSignal<ChatMessageWithAttachments[]>(
    []
  );
  const [userAccessLevel, setUserAccessLevel] = createSignal<
    AccessLevel | undefined
  >();
  const [model, setModel] = createSignal<Model | undefined>();
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [stream, setStream] = createSignal<ChatMessageStream>();
  const [waitingForStream, setWaitingForStream] = createSignal(false);
  const [initialChatState, setInitialChatState] = createSignal<
    | {
        model: Model | undefined;
        attachments: Attachment[];
        text: string | undefined;
      }
    | undefined
  >();
  const userPermissions = createMemo(() => getPermissions(userAccessLevel()));

  const [attachHotkeys, scopeId] = useHotkeyDOMScope('ai-chat');

  const clearChatState = () => {
    const attached = attachments();
    setStream(undefined);
    setModel(undefined);
    setAttachments(attached);
    setText(undefined);
    setMessages([]);
    setUserAccessLevel(undefined);
    setInitialChatState({
      model: undefined,
      attachments: attached,
      text: undefined,
    });
  };

  // reads from inner component state and saves to this component so we can quickly restore on panel open
  const getChatInputState = () => {
    const state = {
      model: model(),
      attachments: attachments(),
      text: text(),
    };
    setInitialChatState(state);
  };

  // saves to local storage
  const saveChatState = () => {
    const chatId_ = chatId();
    if (!chatId_) return;
    storeChatState(chatId_, {
      attachments: attachments(),
      model: model(),
    });
  };

  createEffect(
    on([chatId, attachments, model], () => {
      saveChatState();
    })
  );
  onCleanup(() => {
    saveChatState();
  });

  const { showPaywall } = usePaywallState();
  const sendChatMessage = useSendChatMessage();

  const onSend = async (request: ChatSendInput) => {
    setMessages((p) => [
      ...p,
      {
        id: crypto.randomUUID(),
        content: request.content,
        role: 'user' as const,
        attachments: request.attachments ?? [],
      },
    ]);
    setWaitingForStream(true);

    const result = await sendChatMessage({
      ...request,
      chatId: chatId(),
    });

    setWaitingForStream(false);

    if ('error' in result) {
      if (result.paymentError) {
        showPaywall();
      }
      return;
    }

    // If no chatId existed, a new chat was created
    if (!chatId()) {
      setNewChatId(result.chat_id);
      setChatId(result.chat_id);
      setUserAccessLevel(AccessLevel.owner);
      refetchHistory();
      useWaitChatRename(result.chat_id);
    }

    setStream(result.stream);
    invalidateUserQuota();
  };

  // Check for pending sends from SoupChatInput when bigchat opens
  createEffect(
    on(bigChatOpen, async (isOpen, wasOpen) => {
      if (isOpen && !wasOpen) {
        const pending = getPendingSend();
        if (pending) {
          onSend({
            content: pending.content,
            model: pending.model ?? model() ?? 'claude-haiku-4-5-20251001',
            attachments: pending.attachments ?? [],
            toolset: { type: 'all' },
          });
        }
      }
    })
  );

  // load chat state
  createEffect(
    on(chatId, (chatId_) => {
      // empty chat
      // moving from no chat to some chat
      if (!chatId_) {
        clearChatState();
        return;
      }

      // created a new server chat so we should keep the existing state around
      if (chatId_ === newChatId()) {
        setInitialChatState({
          model: model(),
          attachments: attachments(),
          text: text(),
        });
        setNewChatId(undefined);
        return;
      }

      // load existing server chat
      clearChatState();
      getChatData(chatId_)
        .then(({ messages, name, model, attachments, userAccessLevel }) => {
          setChatName(name);
          setMessages(messages);
          setModel(model);
          setAttachments(attachments);
          setUserAccessLevel(userAccessLevel);
          setInitialChatState({
            model,
            attachments,
            text: undefined,
          });
        })
        .catch((e) => {
          console.error('Failed to load chat messages', e);
          // TODO: show error state
        });
    })
  );

  // Track/untrack chat entity with connection gateway for stream delivery
  createEffect(() => {
    const id = chatId();
    const connected = connectionState() === WebsocketConnectionState.Open;
    if (id && connected) {
      connectionGatewayClient.trackEntity({
        entity_type: 'chat',
        entity_id: id,
        action: 'open',
      });
    }
    onCleanup(() => {
      if (id) {
        connectionGatewayClient.trackEntity({
          entity_type: 'chat',
          entity_id: id,
          action: 'close',
        });
      }
    });
  });

  const toggleRightPanel = useToggleRightPanel();

  registerHotkey({
    scopeId,
    hotkey: 'escape',
    hotkeyToken: TOKENS.chat.spotlight.close,
    condition: () => Boolean(bigChatOpen() || isRightPanelOpen()),
    description: 'Close chat',
    runWithInputFocused: true,
    keyDownHandler: () => {
      if (bigChatOpen()) {
        setBigChatOpen(false);
      } else {
        toggleRightPanel(false);
      }
      return true;
    },
  });

  registerHotkey({
    scopeId,
    hotkey: 'ctrl+t',
    hotkeyToken: TOKENS.chat.new,
    description: 'Create a new chat',
    runWithInputFocused: true,
    keyDownHandler: () => {
      setChatId(undefined);
      return true;
    },
  });

  registerHotkey({
    scopeId,
    hotkey: 'ctrl+c',
    description: 'Stop stream',
    keyDownHandler: () => {
      // TODO: implement stop for connection gateway streams
      return true;
    },
    runWithInputFocused: true,
  });
  return (
    <Show when={isAuthenticated()}>
      <Resize.Panel
        id="sidebar-chat"
        minSize={440}
        maxSize={800}
        hidden={() => !isRightPanelOpen()}
        persistent={true}
      >
        <div
          class="size-full invisible"
          classList={{
            visible: isRightPanelOpen() || bigChatOpen(),
          }}
          ref={(r) => {
            attachHotkeys(r);
          }}
        >
          <SplitlikeContainer
            spotlight={bigChatOpen}
            setSpotlight={setBigChatOpen}
            tr={!bigChatOpen() && !settingsOpen()}
          >
            <Suspense>
              <ChatInputProvider>
                <Rightbar
                  chatId={chatId()}
                  chatName={chatName()}
                  onUnmount={getChatInputState}
                  initialState={initialChatState()}
                  onSend={onSend}
                  userPermissions={userPermissions}
                  setState={{
                    setChatId,
                    setModel,
                    setAttachments,
                    setText,
                  }}
                  isBig={bigChatOpen()}
                >
                  <Show
                    when={chatId()}
                    fallback={
                      <div class="h-full flex flex-col items-center justify-center">
                        <AiChatEmptyState />
                      </div>
                    }
                  >
                    {(id) => (
                      <ChatProvider
                        chatId={id()}
                        external={{
                          messages: [messages, setMessages],
                          stream: [stream, setStream],
                          waitingForStream: [
                            waitingForStream,
                            setWaitingForStream,
                          ],
                        }}
                      >
                        <RightbarChatArea isBig={bigChatOpen()} />
                      </ChatProvider>
                    )}
                  </Show>
                </Rightbar>
              </ChatInputProvider>
            </Suspense>
          </SplitlikeContainer>
        </div>
      </Resize.Panel>
    </Show>
  );
};
