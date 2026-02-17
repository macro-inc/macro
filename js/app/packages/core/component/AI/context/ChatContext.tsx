import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { useAttachments } from '@core/component/AI/signal/attachment';
import { useTabAttachments } from '@core/component/AI/signal/tabAttachments';
import type {
  Attachment,
  Attachments,
  ChatMessageStream,
  ChatMessageWithAttachments,
  Model,
  UploadQueue,
} from '@core/component/AI/types';
import { useUploadAttachment } from '@core/component/AI/util/uploadToChat';
import { ENABLE_AI_AUTO_TAB_ATTACHMENTS } from '@core/constant/featureFlags';
import { getEntityStreams } from '@service-connection/stream';
import type { Accessor, ParentProps, Setter } from 'solid-js';
import {
  createContext,
  createEffect,
  createSignal,
  on,
  untrack,
  useContext,
} from 'solid-js';

// ---- Uncreated state (always present) ----

export type ChatInputState = {
  model: Accessor<Model>;
  setModel: (model?: Model) => void;
  isGenerating: Accessor<boolean>;
  setIsGenerating: (generating: boolean) => void;
  attachments: Attachments;
  uploadQueue: UploadQueue;
};

const ChatInputCtx = createContext<ChatInputState>();

export function ChatInputProvider(
  props: ParentProps & {
    model?: Model;
    isGenerating?: boolean;
    initialAttachments?: Attachment[];
    autoAttach?: boolean;
  }
) {
  const [model, _setModel] = createSignal<Model>(props.model ?? DEFAULT_MODEL);
  const setModel = (m?: Model) => _setModel(m ?? DEFAULT_MODEL);

  const [isGenerating, setIsGenerating] = createSignal<boolean>(
    props.isGenerating ?? false
  );

  const attachments = useAttachments(props.initialAttachments);
  const uploadQueue = useUploadAttachment();

  const tabAttachments = useTabAttachments();
  if (ENABLE_AI_AUTO_TAB_ATTACHMENTS && props.autoAttach !== false) {
    createEffect(
      on(tabAttachments, (tabs, p) => {
        for (const prev of p ?? []) {
          if (!tabs.find((t) => t.attachmentId === prev.attachmentId)) {
            attachments.removeAttachment(prev.attachmentId);
          }
        }
        for (const tab of tabs) {
          attachments.addAttachment(tab);
        }
      })
    );
  }

  return (
    <ChatInputCtx.Provider
      value={{
        model,
        setModel,
        isGenerating,
        setIsGenerating,
        attachments,
        uploadQueue,
      }}
    >
      {props.children}
    </ChatInputCtx.Provider>
  );
}

export function useChatInputContext(): ChatInputState {
  const ctx = useContext(ChatInputCtx);
  if (!ctx) {
    throw new Error(
      'useChatInputContext must be used within <ChatInputProvider />'
    );
  }
  return ctx;
}

// ---- Created state (only when chat exists) ----

export type ChatState = {
  chatId: Accessor<string>;
  messages: Accessor<ChatMessageWithAttachments[]>;
  setMessages: Setter<ChatMessageWithAttachments[]>;
  addMessage: (msg: ChatMessageWithAttachments) => void;
  stream: Accessor<ChatMessageStream | undefined>;
  setStream: Setter<ChatMessageStream | undefined>;
  waitingForStream: Accessor<boolean>;
  setWaitingForStream: Setter<boolean>;
};

const ChatCtx = createContext<ChatState>();

export function ChatProvider(
  props: ParentProps & {
    chatId: string;
    messages?: ChatMessageWithAttachments[];
    external?: {
      messages: [
        Accessor<ChatMessageWithAttachments[]>,
        Setter<ChatMessageWithAttachments[]>,
      ];
      stream: [
        Accessor<ChatMessageStream | undefined>,
        Setter<ChatMessageStream | undefined>,
      ];
      waitingForStream?: [Accessor<boolean>, Setter<boolean>];
    };
  }
) {
  let messages: Accessor<ChatMessageWithAttachments[]>;
  let setMessages: Setter<ChatMessageWithAttachments[]>;
  let stream: Accessor<ChatMessageStream | undefined>;
  let setStream: Setter<ChatMessageStream | undefined>;
  let waitingForStream: Accessor<boolean>;
  let setWaitingForStream: Setter<boolean>;

  if (props.external) {
    [messages, setMessages] = props.external.messages;
    [stream, setStream] = props.external.stream;
    if (props.external.waitingForStream) {
      [waitingForStream, setWaitingForStream] = props.external.waitingForStream;
    } else {
      [waitingForStream, setWaitingForStream] = createSignal(false);
    }
  } else {
    const [_messages, _setMessages] = createSignal<
      ChatMessageWithAttachments[]
    >(props.messages ?? []);
    const [_stream, _setStream] = createSignal<ChatMessageStream>();
    messages = _messages;
    setMessages = _setMessages;
    stream = _stream;
    setStream = _setStream;
    [waitingForStream, setWaitingForStream] = createSignal(false);
  }

  const _setMessages = setMessages;
  const addMessage = (msg: ChatMessageWithAttachments) => {
    _setMessages((p) => [...p, msg]);
  };

  // --- Reconnect active streams on page refresh ---
  // Reactive to props.chatId (ChatProvider may not remount on chat switch).
  // Uses untrack for stream/messages to only fire on new WS streams or chatId change.
  createEffect(() => {
    const activeStreams = getEntityStreams('chat', props.chatId)();

    for (const s of activeStreams) {
      const sid = s.id()?.stream_id;
      if (!sid || s.isDone()) continue;

      const isInMessages = untrack(() => messages().some((m) => m.id === sid));
      if (isInMessages) continue;

      setStream({
        data: s.data,
        isDone: s.isDone,
        model: DEFAULT_MODEL,
        attachments: [],
        streamId: sid,
      });
      break;
    }
  });

  return (
    <ChatCtx.Provider
      value={{
        chatId: () => props.chatId,
        messages,
        setMessages,
        addMessage,
        stream,
        setStream,
        waitingForStream,
        setWaitingForStream,
      }}
    >
      {props.children}
    </ChatCtx.Provider>
  );
}

export function useChatContext(): ChatState {
  const ctx = useContext(ChatCtx);
  if (!ctx) {
    throw new Error('useChatContext must be used within <ChatProvider />');
  }
  return ctx;
}

export function useChatContextOptional(): ChatState | undefined {
  return useContext(ChatCtx);
}
