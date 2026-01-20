import type {
  cognitionApiServiceClient,
  cognitionWebsocketServiceClient,
} from '@service-cognition/client';
import type { Model } from '@service-cognition/generated/schemas';
import type { MessageStream } from '@service-cognition/websocket';
import type { Attachment } from './attachment';

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
  content: string;
  attachments: Attachment[];
  model: Model;
};

export type Send = {
  type: 'send';
  chat_id: string;
  call: () => MessageStream;
  request: SendChatMessageArgs;
};

export type Edit = Send;
