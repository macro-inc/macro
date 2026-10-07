import { createSearchParamsCodec } from '@app/lib/split-router';
import { z } from 'zod';

export const chatDetailSearch = {
  namespace: 'chat-detail',
  schema: z.object({
    chatId: z.string(),
    messageId: z.string(),
    share: z.string(),
    seek: z.string(),
  }),
  defaults: { chatId: '', messageId: '', share: '', seek: '' },
};

export const chatDetailSearchCodec = createSearchParamsCodec(chatDetailSearch);

/** Normalize explicit host input without borrowing an ancestor route. */
export function chatLocationParams(params?: object): Record<string, string> {
  const source = (params ?? {}) as Record<string, unknown>;
  return {
    ...(typeof source.message_id === 'string'
      ? { message_id: source.message_id }
      : {}),
    ...(typeof source.share === 'string' ? { share: source.share } : {}),
  };
}

export function chatLocationUpdates(
  chatId: string,
  params: object = {},
  seek: string = crypto.randomUUID()
) {
  const location = chatLocationParams(params);
  return {
    [chatDetailSearch.namespace]: chatDetailSearchCodec.serialize({
      chatId,
      messageId: location.message_id ?? '',
      share: location.share ?? '',
      seek,
    }),
  };
}
