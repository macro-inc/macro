import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { useAttachments } from '@core/component/AI/signal/attachment';
import { useTabAttachments } from '@core/component/AI/signal/tabAttachments';
import type {
  Attachment,
  Attachments,
  ChatMessageWithAttachments,
  MessageStream,
  Model,
  UploadQueue,
} from '@core/component/AI/types';
import { useUploadAttachment } from '@core/component/AI/util/uploadToChat';
import { ENABLE_AI_AUTO_TAB_ATTACHMENTS } from '@core/constant/featureFlags';
import type { Accessor, ParentProps, Setter } from 'solid-js';
import {
  createContext,
  createEffect,
  createSignal,
  on,
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
  stream: Accessor<MessageStream | undefined>;
  setStream: Setter<MessageStream | undefined>;
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
        Accessor<MessageStream | undefined>,
        Setter<MessageStream | undefined>,
      ];
    };
  }
) {
  let messages: Accessor<ChatMessageWithAttachments[]>;
  let setMessages: Setter<ChatMessageWithAttachments[]>;
  let stream: Accessor<MessageStream | undefined>;
  let setStream: Setter<MessageStream | undefined>;

  if (props.external) {
    [messages, setMessages] = props.external.messages;
    [stream, setStream] = props.external.stream;
  } else {
    const [_messages, _setMessages] = createSignal<
      ChatMessageWithAttachments[]
    >(props.messages ?? []);
    const [_stream, _setStream] = createSignal<MessageStream>();
    messages = _messages;
    setMessages = _setMessages;
    stream = _stream;
    setStream = _setStream;
  }

  const _setMessages = setMessages;
  const addMessage = (msg: ChatMessageWithAttachments) => {
    _setMessages((p) => [...p, msg]);
  };

  return (
    <ChatCtx.Provider
      value={{
        chatId: () => props.chatId,
        messages,
        setMessages,
        addMessage,
        stream,
        setStream,
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
