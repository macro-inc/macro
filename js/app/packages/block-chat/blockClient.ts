import type { useBuildChatSendRequest } from '@core/component/AI/component/input/buildRequest';

export type SendBuilder = Parameters<
  ReturnType<typeof useBuildChatSendRequest>
>[0] & {
  chatId: string;
};

export type BlockChatSpec = {
  setQuote: (quote: string) => Promise<void>;
  sendMessage: (request: SendBuilder) => Promise<void>;
  goToLocationFromParams: (params: Record<string, any>) => Promise<void>;
};
