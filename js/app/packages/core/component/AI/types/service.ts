import type { ChatStream, Model } from '@service-cognition/generated/schemas';
import type { Accessor } from 'solid-js';
import type { Attachment } from './attachment';

export interface ChatMessageStream {
  data: Accessor<ChatStream[]>;
  isDone: Accessor<boolean>;
  model: Model;
  attachments: Attachment[];
  streamId?: string;
}
