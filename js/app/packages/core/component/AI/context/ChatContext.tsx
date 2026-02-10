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
import {
  createContextProvider,
  type ContextProviderProps,
} from '@solid-primitives/context';
import type { Accessor, Setter } from 'solid-js';
import { createEffect, createSignal, on } from 'solid-js';

export type ChatContextValue = {
  // Identity
  chatId: Accessor<string | undefined>;
  setChatId: (chatId: string | undefined) => void;

  // Input state
  model: Accessor<Model>;
  setModel: (model?: Model) => void;
  isGenerating: Accessor<boolean>;
  setIsGenerating: (generating: boolean) => void;
  attachments: Attachments;
  uploadQueue: UploadQueue;

  // Message state (undefined for input-only consumers like SoupChatInput)
  messages: Accessor<ChatMessageWithAttachments[]> | undefined;
  setMessages: Setter<ChatMessageWithAttachments[]> | undefined;
  addMessage: ((msg: ChatMessageWithAttachments) => void) | undefined;
  stream: Accessor<MessageStream | undefined> | undefined;
  setStream: Setter<MessageStream | undefined> | undefined;
};

export type ChatContextProviderProps = ContextProviderProps & {
  // Initial values for self-owned mode
  chatId?: string;
  model?: Model;
  isGenerating?: boolean;
  initialAttachments?: Attachment[];
  autoAttach?: boolean;

  // When provided, creates message/stream signals with initial messages
  messages?: ChatMessageWithAttachments[];

  // External state injection (for Rightbar)
  external?: {
    chatId: [Accessor<string | undefined>, (id: string | undefined) => void];
    messages: [
      Accessor<ChatMessageWithAttachments[]>,
      Setter<ChatMessageWithAttachments[]>,
    ];
    stream: [
      Accessor<MessageStream | undefined>,
      Setter<MessageStream | undefined>,
    ];
  };
};

function createChatContext(props: ChatContextProviderProps): ChatContextValue {
  // --- chatId ---
  let chatId: Accessor<string | undefined>;
  let setChatId: (id: string | undefined) => void;
  if (props.external) {
    [chatId, setChatId] = props.external.chatId;
  } else {
    const [_chatId, _setChatId] = createSignal<string | undefined>(
      props.chatId
    );
    chatId = _chatId;
    setChatId = _setChatId;
  }

  // --- model (always self-owned) ---
  const [model, _setModel] = createSignal<Model>(props.model ?? DEFAULT_MODEL);
  const setModel = (m?: Model) => _setModel(m ?? DEFAULT_MODEL);

  // --- isGenerating (always self-owned) ---
  const [isGenerating, setIsGenerating] = createSignal<boolean>(
    props.isGenerating ?? false
  );

  // --- attachments (always self-owned) ---
  const attachments = useAttachments(props.initialAttachments);

  // --- uploadQueue (always self-owned) ---
  const uploadQueue = useUploadAttachment();

  // --- tab auto-attachment ---
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

  // --- messages / stream ---
  let messages: Accessor<ChatMessageWithAttachments[]> | undefined;
  let setMessages: Setter<ChatMessageWithAttachments[]> | undefined;
  let addMessage: ((msg: ChatMessageWithAttachments) => void) | undefined;
  let stream: Accessor<MessageStream | undefined> | undefined;
  let setStream: Setter<MessageStream | undefined> | undefined;

  if (props.external) {
    [messages, setMessages] = props.external.messages;
    [stream, setStream] = props.external.stream;
    addMessage = (msg: ChatMessageWithAttachments) => {
      setMessages!((p) => [...p, msg]);
    };
  } else if (props.messages !== undefined) {
    const [_messages, _setMessages] = createSignal<
      ChatMessageWithAttachments[]
    >(props.messages);
    const [_stream, _setStream] = createSignal<MessageStream>();
    messages = _messages;
    setMessages = _setMessages;
    stream = _stream;
    setStream = _setStream;
    addMessage = (msg: ChatMessageWithAttachments) => {
      _setMessages((p) => [...p, msg]);
    };
  }
  // else: messages/stream remain undefined (input-only mode)

  return {
    chatId,
    setChatId,
    model,
    setModel,
    isGenerating,
    setIsGenerating,
    attachments,
    uploadQueue,
    messages,
    setMessages,
    addMessage,
    stream,
    setStream,
  };
}

const [ChatContextProvider, useContextInternal] =
  createContextProvider(createChatContext);

export { ChatContextProvider };

export function useChatContext(): ChatContextValue {
  const ctx = useContextInternal();
  if (ctx === undefined) {
    throw new Error(
      'useChatContext must be used within <ChatContextProvider />'
    );
  }
  return ctx;
}

export function useChatContextOptional(): ChatContextValue | undefined {
  return useContextInternal();
}
