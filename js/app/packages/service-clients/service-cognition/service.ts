import type { ToWebSocketMessage } from './generated/schemas';
import type { MessageStream } from './websocket';

type MessageType<T extends ToWebSocketMessage['type']> = Omit<
  Extract<ToWebSocketMessage, { type: T }>,
  'type'
>;

// utility type to remove stream_id for websocket client requests
// where it is automatically injected
type NoStreamId<T> = Omit<T, 'stream_id'>;

export type CognitionWebsocketService = {
  streamEditMessage: (
    args: NoStreamId<MessageType<'edit_chat_message'>>
  ) => MessageStream;
  sendStreamChatMessage: (
    args: NoStreamId<MessageType<'send_chat_message'>>
  ) => MessageStream;
  stopChatMessage: (args: MessageType<'stop_chat_message'>) => Promise<void>;
  selectModel: (args: MessageType<'select_model_for_chat'>) => Promise<void>;
  extractionStatus: (args: MessageType<'extraction_status'>) => Promise<void>;
  sendCompletion: (args: MessageType<'send_completion'>) => Promise<void>;
  streamSimpleCompletion: (
    args: MessageType<'get_simple_completion_stream'>
  ) => Promise<void>;
  editLastMessage: (
    args: NoStreamId<MessageType<'edit_chat_message'>>
  ) => Promise<void>;
  extractionStatusSync: (
    args: MessageType<'extraction_status'>
  ) => Promise<'ok' | 'error'>;
};
