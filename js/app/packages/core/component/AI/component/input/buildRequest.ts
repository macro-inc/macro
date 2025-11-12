import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { useAdditionalInstructions } from '@core/component/AI/constant/prompts';
import type {
  Attachment,
  CreateAndSend,
  MessageStream,
  Model,
  Send,
  ToolSet,
} from '@core/component/AI/types';
import { isPaymentError } from '@core/util/handlePaymentError';
import { isErr } from '@core/util/maybeResult';
import { getMacroApiToken } from '@service-auth/fetch';
import {
  cognitionApiServiceClient,
  cognitionWebsocketServiceClient,
} from '@service-cognition/client';
import type { Source } from './ToolsetSelector';

function sourceToPrompt(source?: Source): string {
  if (!source) return '';
  let prompt = (s: string) =>
    `\nThe user has requested that you only consider ${s}. If you choose to use tools only use tools to search, list or read ${s}`;
  if (source === 'everything') return '';
  else if (source === 'channel') return prompt('channels');
  else if (source === 'chat') return prompt('chats');
  else if (source === 'document') return prompt('documents');
  else return prompt('email');
}

export function useBuildChatSendRequest() {
  const additionalInstructions = useAdditionalInstructions();
  return async function buildChatSendRequest({
    userRequest,
    chatId,
    isPersistent,
    model,
    attachments,
    toolset,
    source,
  }: {
    userRequest: string;
    chatId: string | undefined;
    isPersistent?: boolean;
    model?: Model;
    attachments?: Attachment[];
    toolset?: ToolSet;
    source?: Source;
  }): Promise<CreateAndSend | Send> {
    const token = await getMacroApiToken();

    const additional = `${additionalInstructions()}${sourceToPrompt(source)}`;

    const request = (id: string): Send['request'] => ({
      chat_id: id,
      content: userRequest,
      model: model ?? DEFAULT_MODEL,
      attachments: attachments ?? [],
      token,
      additional_instructions: additional,
      toolset,
    });

    if (chatId !== undefined) {
      const send: Send = {
        type: 'send',
        chat_id: chatId,
        request: request(chatId),
        call: () => {
          return cognitionWebsocketServiceClient.sendStreamChatMessage(
            request(chatId)
          );
        },
      };
      return send;
    } else {
      const createAndSend: CreateAndSend = {
        type: 'createAndSend',
        request: {},
        call: async () => {
          const response = await cognitionApiServiceClient.createChat({
            isPersistent: isPersistent ?? false,
          });
          if (isPaymentError(response)) {
            return { type: 'error', paymentError: true };
          }
          if (isErr(response)) {
            return { type: 'error' };
          }
          const [, { id: chatId }] = response;
          return {
            type: 'send',
            chat_id: chatId,
            request: request(chatId),
            call: (): MessageStream => {
              return cognitionWebsocketServiceClient.sendStreamChatMessage(
                request(chatId)
              );
            },
          };
        },
      };
      return createAndSend;
    }
  };
}
