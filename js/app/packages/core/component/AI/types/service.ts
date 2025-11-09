import type {
  cognitionApiServiceClient,
  cognitionWebsocketServiceClient,
} from '@service-cognition/client';
import type { MessageStream } from '@service-cognition/websocket';

export type SendChatMessageArgs = Parameters<
  (typeof cognitionWebsocketServiceClient)['sendStreamChatMessage']
>[0];

export type CreateMessageArgs = Parameters<
  (typeof cognitionApiServiceClient)['createChat']
>[0];

export type CreateAndSend = {
  type: 'createAndSend';
  call: () => Promise<{ type: 'error'; paymentError?: true } | Send>;
  request: CreateMessageArgs;
};

export type Send = {
  type: 'send';
  chat_id: string;
  call: () => MessageStream;
  request: SendChatMessageArgs;
};

export type Edit = Send;
