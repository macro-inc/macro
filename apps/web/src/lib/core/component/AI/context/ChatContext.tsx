import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { useAttachments } from '@core/component/AI/signal/attachment';
import {
  type ChatController,
  type ChatControllerOptions,
  createChatController,
} from '@core/component/AI/state/createChatController';
import type {
  Attachment,
  Attachments,
  ChatMessageWithAttachments,
  Model,
  UploadQueue,
} from '@core/component/AI/types';
import { useUploadAttachment } from '@core/component/AI/util/uploadToChat';
import type { Accessor, ParentProps } from 'solid-js';
import { createContext, createSignal, useContext } from 'solid-js';

// ---- Uncreated state (always present) ----

type ChatInputState = {
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
  }
) {
  const [model, _setModel] = createSignal<Model>(props.model ?? DEFAULT_MODEL);
  const setModel = (m?: Model) => _setModel(m ?? DEFAULT_MODEL);

  const [isGenerating, setIsGenerating] = createSignal<boolean>(
    props.isGenerating ?? false
  );

  const attachments = useAttachments(props.initialAttachments);
  const uploadQueue = useUploadAttachment();

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

type ChatState = ChatController;

const ChatCtx = createContext<ChatState>();

export function ChatProvider(
  props: ParentProps & {
    chatId: string;
    messages?: ChatMessageWithAttachments[];
    controllerOptions?: ChatControllerOptions;
  }
) {
  const controller = createChatController(
    props.chatId,
    props.messages ?? [],
    props.controllerOptions
  );

  return (
    <ChatCtx.Provider value={controller}>{props.children}</ChatCtx.Provider>
  );
}

export function useChatContext(): ChatState {
  const ctx = useContext(ChatCtx);
  if (!ctx) {
    throw new Error('useChatContext must be used within <ChatProvider />');
  }
  return ctx;
}

function _useChatContextOptional(): ChatState | undefined {
  return useContext(ChatCtx);
}
