export {
  ChatInputProvider,
  useChatInputContext,
  ChatProvider,
  useChatContext,
  useChatContextOptional,
  type ChatInputState,
  type ChatState,
} from './ChatContext';

export type { ChatPhase, ChatEvent } from '@core/component/AI/state/chatState';
export type { ChatController } from '@core/component/AI/state/createChatController';
