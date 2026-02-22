import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { useAdditionalInstructions } from '@core/component/AI/constant/prompts';
import type { Attachment, Model, ToolSet } from '@core/component/AI/types';
import { isPaymentError } from '@core/util/handlePaymentError';
import { isErr } from '@core/util/maybeResult';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { ChatMessageStream } from '@service-connection/stream';
import { subscribe } from '@service-connection/stream';

export type ChatSendInput = {
  content: string;
  model: Model;
  attachments: Attachment[];
  toolset: ToolSet;
};

export type SendChatMessageResult =
  | { stream: ChatMessageStream; chat_id: string }
  | { error: true; paymentError?: boolean };

export function useSendChatMessage() {
  const additionalInstructions = useAdditionalInstructions();

  return async function sendChatMessage({
    content,
    model,
    chatId,
    attachments,
    toolset,
  }: ChatSendInput & { chatId?: string }): Promise<SendChatMessageResult> {
    const modelInstructions = model ? `\nYou are ${model}` : '';
    const additional = `${additionalInstructions()}${modelInstructions}`;

    const response = await cognitionApiServiceClient.sendStreamChatMessage({
      content,
      model: model ?? DEFAULT_MODEL,
      chat_id: chatId,
      attachments: attachments.length > 0 ? attachments : undefined,
      toolset,
      additional_instructions: additional,
    });

    if (isPaymentError(response)) {
      return { error: true, paymentError: true };
    }
    if (isErr(response)) {
      return { error: true };
    }

    const [, { stream_id, chat_id }] = response;

    const connectionStream = subscribe('chat', chat_id, stream_id);
    if (!connectionStream) {
      return { error: true };
    }

    return {
      chat_id,
      stream: {
        data: connectionStream.data,
        isDone: connectionStream.isDone,
        id: () => ({
          entity_id: chat_id,
          stream_id: stream_id,
          entity_type: 'chat',
        }),
      },
    };
  };
}
