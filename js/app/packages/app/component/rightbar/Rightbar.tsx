import { globalSplitManager } from '@app/signal/splitLayout';
import { useIsAuthenticated } from '@core/auth';
import { DragDropWrapper } from '@core/component/AI/component/DragDrop';
import { useChatInput } from '@core/component/AI/component/input/useChatInput';
import { ChatMessages } from '@core/component/AI/component/message/ChatMessages';
import { registerToolHandler } from '@core/component/AI/signal/tool';
import type {
  Attachment,
  ChatMessageWithAttachments,
  CreateAndSend,
  MessageStream,
  Model,
  Send,
} from '@core/component/AI/types';
import { parseModel } from '@core/component/AI/util';
import {
  getChatInputStoredState,
  storeChatState,
} from '@core/component/AI/util/storage';
import { IconButton } from '@core/component/IconButton';
import { DropdownMenuContent, MenuItem } from '@core/component/Menu';
import { ReferencesModal } from '@core/component/ReferencesModal';
import { Resize } from '@core/component/Resize';
import { ENABLE_REFERENCES_MODAL } from '@core/constant/featureFlags';
import { usePaywallState } from '@core/constant/PaywallState';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import {
  isRightPanelOpen,
  useBigChat,
  useToggleRightPanel,
} from '@core/signal/layout';
import { rightbarChatId, setRightbarChatId } from '@core/signal/rightbar';
import { useDisplayName } from '@core/user';
import { isErr } from '@core/util/maybeResult';
import ContractIcon from '@icon/regular/arrows-in.svg';
import ExpandIcon from '@icon/regular/arrows-out.svg';
import ChatIcon from '@icon/regular/chat.svg';
import HistoryIcon from '@icon/regular/clock-counter-clockwise.svg';
import NotepadIcon from '@icon/regular/notepad.svg';
import PlusIcon from '@icon/regular/plus.svg';
import XIcon from '@icon/regular/x.svg';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { invalidateUserQuota } from '@service-auth/userQuota';
import {
  cognitionApiServiceClient,
  cognitionWebsocketServiceClient,
} from '@service-cognition/client';
import { createCognitionWebsocketEffect } from '@service-cognition/websocket';
import { useUserId } from '@service-gql/client';
import { refetchHistory, useHistory } from '@service-storage/history';
import { useOpenInstructionsMd } from 'core/component/AI/util/instructions';
import type { LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  onCleanup,
  type Setter,
  Show,
  untrack,
} from 'solid-js';
import { SplitlikeContainer } from '../split-layout/components/SplitContainer';

type ChatData = {
  messages: ChatMessageWithAttachments[];
  name: string | undefined;
  model: Model | undefined;
  attachments: Attachment[];
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

  return { messages, name, model, attachments };
};

const usePersistentChats = () => {
  const history = useHistory();
  return createMemo(() =>
    history().filter((item) => item.type === 'chat' && item.isPersistent)
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
        <IconButton
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
}) {
  const createNewRightbarChat = () => {
    props.setChatId(undefined);
  };
  const openInstructions = useOpenInstructionsMd();
  const [bigChatOpen, setBigChatOpen] = useBigChat();
  const toggleRightPanel = useToggleRightPanel();

  return (
    <div
      class="h-[calc(2.5rem-1px)] border-b border-edge-muted flex items-center w-full px-2 shrink-0 grow-0"
      data-split-panel
    >
      <IconButton
        size="sm"
        icon={XIcon}
        tooltip={{ label: 'Close Assistant Panel' }}
        theme="current"
        onClick={() => {
          if (bigChatOpen()) {
            setBigChatOpen(false);
          } else {
            toggleRightPanel();
          }
        }}
      />
      <IconButton
        size="sm"
        icon={PlusIcon}
        tooltip={{ label: 'Start new thread' }}
        theme="current"
        onClick={() => {
          createNewRightbarChat();
        }}
      />
      <div class="grow" />
      <Show when={ENABLE_REFERENCES_MODAL && props.chatId}>
        <ReferencesModal
          documentId={props.chatId!}
          documentName={props.chatName ?? 'New Chat'}
        />
      </Show>
      <IconButton
        size="sm"
        icon={NotepadIcon}
        tooltip={{ label: 'Edit AI Instructions' }}
        theme="current"
        onClick={() => {
          openInstructions();
        }}
      />
      <PersistentChatHistoryButton setChatId={props.setChatId} />
      <IconButton
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
  );
}

export function Rightbar(props: {
  chatId: string | undefined;
  chatName: string | undefined;
  stream: Accessor<MessageStream | undefined>;
  onSend: (args: CreateAndSend | Send) => void;
  onUnmount?: () => void;
  messages: Accessor<ChatMessageWithAttachments[]>;
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
    setMessages: Setter<ChatMessageWithAttachments[]>;
    setStream: Setter<MessageStream | undefined>;
  };
  isBig?: boolean;
  setIsBig?: (val: boolean) => void;
}) {
  let messagesContainerRef!: HTMLDivElement;

  createEffect(() => {
    const stream_ = props.stream();
    if (stream_ && stream_.data().length > 0) {
      invalidateUserQuota();
    }
  });

  createEffect(() => {
    const stream_ = props.stream();
    if (!stream_ || stream_.isDone()) {
      setIsGenerating(false);
      if (stream_?.isDone()) {
        invalidateUserQuota();
      }
      return;
    } else {
      setIsGenerating(true);
    }
  });

  registerToolHandler(props.stream);

  const stopGenerating = () => {
    const stream_ = props.stream();
    if (!stream_) return;
    cognitionWebsocketServiceClient.stopChatMessage({
      stream_id: stream_.request.stream_id,
    });
    stream_.close();
  };

  // NOTE: due to mount race condition in the markdown area, we need to set the initial value here
  const {
    ChatInput,
    setChatId,
    attachments,
    chatMarkdownArea,
    model,
    setModel,
    setIsGenerating,
    uploadQueue,
  } = useChatInput({ initialValue: props.initialState?.text });

  createEffect(() => {
    setChatId(props.chatId);
    if (!props.initialState) return;
    setModel(props.initialState.model);
    attachments.setAttached(props.initialState.attachments);
  });

  onCleanup(() => {
    props.onUnmount?.();
  });

  createEffect(() => {
    const input = chatMarkdownArea.markdownText();
    const attached = attachments.attached();
    const model_ = model();
    props.setState.setText(input);
    props.setState.setAttachments(attached);
    props.setState.setModel(model_);
  });

  const timeString = () => {
    const now = new Date().getHours();
    if (now < 12) {
      return 'morning';
    } else if (now < 18) {
      return 'afternoon';
    } else {
      return 'evening';
    }
  };
  const userId = useUserId();
  const [name] = useDisplayName(userId());

  let greeting = () => {
    const firstName = name().split(' ').at(0);
    if (!firstName || firstName.length === 0 || firstName.includes('@')) {
      return ``;
    } else {
      return `Good ${timeString()} ${firstName}, what can I assist you with?`;
    }
  };

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

  createEffect(() => {
    if (props.isBig) {
      borrowedFocus = document.activeElement;
      editor()?.focus();
    } else {
      if (untrack(isRightPanelOpen)) {
        return;
      } else {
        returnFocus();
      }
    }
  });

  createEffect(() => {
    if (isRightPanelOpen()) {
      borrowedFocus = document.activeElement;
      editor()?.focus();
    } else {
      returnFocus();
    }
  });

  return (
    <DragDropWrapper
      class="relative flex flex-col size-full select-none"
      uploadQueue={uploadQueue}
    >
      <div class="overflow-hidden size-full flex flex-col items-center">
        <TopBar
          chatId={props.chatId}
          setChatId={props.setState.setChatId}
          chatName={props.chatName}
        />
        <div class="flex flex-col flex-1 min-h-0 p-2 w-full items-center">
          <Show when={props.isBig && props.messages().length === 0}>
            <h1 class="text-ink-extra-muted/40 text-2xl flex-1 flex flex-col items-center justify-center">
              {greeting()}
            </h1>
          </Show>
          <Show when={props.messages().length > 0 || !props.isBig}>
            <div
              data-chat-scroll
              class="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth flex justify-center w-full"
              ref={messagesContainerRef}
            >
              <div class="w-full macro-message-width">
                <ChatMessages
                  chatId={props.chatId}
                  messages={[props.messages, props.setState.setMessages]}
                  messageActions={undefined}
                  stream={[props.stream, props.setState.setStream]}
                />
              </div>
            </div>
          </Show>

          <div class="w-full">
            <div class="flex-shrink-0 pt-2 macro-message-width mx-auto">
              <ChatInput
                isPersistent
                showActiveTabs
                onSend={props.onSend}
                onStop={stopGenerating}
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
  const [model, setModel] = createSignal<Model | undefined>();
  const [attachments, setAttachments] = createSignal<Attachment[]>([]);
  const [stream, setStream] = createSignal<MessageStream>();
  const [initialChatState, setInitialChatState] = createSignal<
    | {
        model: Model | undefined;
        attachments: Attachment[];
        text: string | undefined;
      }
    | undefined
  >();

  const [attachHotkeys, scopeId] = useHotkeyDOMScope('ai-right-panel');

  const clearChatState = () => {
    setStream(undefined);
    setModel(undefined);
    setAttachments([]);
    setText(undefined);
    setMessages([]);
    setInitialChatState({
      model: undefined,
      attachments: [],
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

  // TODO: move this into a shared util: see dcs websocket extraction and connection websocket bulk upload
  const CHAT_RENAME_TIMEOUT_MS = 60000;
  const chatRenameMap = new Map<
    string,
    {
      callback: (name: string | undefined) => void;
      clearTimeout: () => void;
    }
  >();
  const waitChatRename = async (chatId: string) => {
    const dispose = createCognitionWebsocketEffect('chat_renamed', (data) => {
      if (data.chat_id !== chatId) return;
      const chatInfo = chatRenameMap.get(chatId);
      if (!chatInfo) return;
      chatInfo.callback(data.name);
      dispose();
    });

    return new Promise<string | undefined>((accept) => {
      // always run this after timeout
      setTimeout(() => {
        dispose();
        chatRenameMap.delete(chatId);
      }, CHAT_RENAME_TIMEOUT_MS);

      const errorTimeout = setTimeout(() => {
        accept(undefined);
      }, CHAT_RENAME_TIMEOUT_MS);

      chatRenameMap.set(chatId, {
        callback: accept,
        clearTimeout: () => clearTimeout(errorTimeout),
      });
    });
  };

  const { showPaywall } = usePaywallState();

  const onSend = async (request: Send | CreateAndSend) => {
    if (request.type === 'createAndSend') {
      const response = await request.call();
      if (response.type === 'error') {
        // TODO: show error state
        console.error('error creating chat', response);
        if (response.paymentError) {
          showPaywall();
        }
        return;
      }
      const newChatId = response.chat_id;
      setNewChatId(newChatId);
      setChatId(newChatId);

      // TODO: move this into a separate resource so we don't have to refetch history
      // refetch history immediately to have the new chat id
      // then rename again when the server provides a default name
      refetchHistory();
      waitChatRename(newChatId).then((_name) => {
        refetchHistory();
      });
      return await onSend(response);
    } else if (request.type === 'send') {
      setMessages((p) => {
        return [
          ...p,
          {
            attachments: request.request.attachments ?? [],
            content: request.request.content,
            role: 'user',
            // TODO: no id because it's a user message that hasn't been uploaded yet
            id: '',
          },
        ];
      });

      const stream = request.call();
      setStream(stream);
      invalidateUserQuota();
    } else {
      console.error('Invalid send request', request);
    }
  };

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
        .then(({ messages, name, model, attachments }) => {
          setChatName(name);
          setMessages(messages);
          setModel(model);
          setAttachments(attachments);
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

  const toggleRightPanel = useToggleRightPanel();

  registerHotkey({
    scopeId,
    hotkey: 'escape',
    hotkeyToken: TOKENS.chat.spotlight.close,
    condition: () => Boolean(bigChatOpen() || isRightPanelOpen()),
    description: 'Close chat',
    keyDownHandler: () => {
      if (bigChatOpen()) {
        setBigChatOpen(false);
      } else {
        toggleRightPanel(false);
      }
      return true;
    },
  });

  return (
    <Show when={isAuthenticated()}>
      <Resize.Panel
        id="sidebar-chat"
        minSize={324}
        maxSize={1000}
        hidden={() => !isRightPanelOpen()}
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
          >
            <Rightbar
              chatId={chatId()}
              chatName={chatName()}
              messages={messages}
              onUnmount={getChatInputState}
              initialState={initialChatState()}
              onSend={onSend}
              stream={stream}
              setState={{
                setChatId,
                setModel,
                setAttachments,
                setText,
                setMessages,
                setStream,
              }}
              isBig={bigChatOpen()}
            />
          </SplitlikeContainer>
        </div>
      </Resize.Panel>
    </Show>
  );
};
