import type { Attachment, Model, ToolSet } from '@core/component/AI/types';

export type SendBuilder = {
  userRequest: string;
  chatId?: string;
  isPersistent?: boolean;
  model?: Model;
  attachments?: Attachment[];
  toolset?: ToolSet;
};

export type BlockChatSpec = {
  setQuote: (quote: string) => Promise<void>;
  sendMessage: (request: SendBuilder) => Promise<void>;
  goToLocationFromParams: (params: Record<string, any>) => Promise<void>;
};
