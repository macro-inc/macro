import { analytics } from '@app/lib/analytics';
import { isAiUsageLimitError } from '@app/lib/service-clients/ai-usage-limit';
import { DEFAULT_MODEL } from '@core/component/AI/constant';
import { useAdditionalInstructions } from '@core/component/AI/constant/prompts';
import type { Attachment, Model, ToolSet } from '@core/component/AI/types';
import { isPaymentError } from '@core/util/handlePaymentError';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type { ChatMessageStream } from '@service-connection/stream';
import { subscribe } from '@service-connection/stream';
import type { ModelSpeed } from '../../constant/speed';

export type ChatSendInput = {
  content: string;
  model: Model;
  speed?: ModelSpeed;
  attachments: Attachment[];
  toolset: ToolSet;
  metaKey?: boolean;
};

type SendChatMessageResult =
  | { stream: ChatMessageStream; chat_id: string }
  | {
      error: true;
      paymentError?: boolean;
      /** The billing gate refused the send; carries the backend reason code. */
      usageLimit?: string;
    };

export function useSendChatMessage() {
  const additionalInstructions = useAdditionalInstructions();

  return async function sendChatMessage({
    content,
    model,
    speed,
    chatId,
    attachments,
    toolset,
  }: ChatSendInput & { chatId?: string }): Promise<SendChatMessageResult> {
    const response = await cognitionApiServiceClient.sendStreamChatMessage({
      content,
      model: model ?? DEFAULT_MODEL,
      speed: speed ?? 'standard',
      chat_id: chatId,
      attachments: attachments.length > 0 ? attachments : undefined,
      toolset,
      additional_instructions: additionalInstructions(chatId),
    });

    if (response.isErr()) {
      const usageLimit = response.error.find(isAiUsageLimitError);
      if (usageLimit) {
        return { error: true, usageLimit: usageLimit.reason };
      }
    }
    if (isPaymentError(response)) {
      return { error: true, paymentError: true };
    }
    if (response.isErr()) {
      return { error: true };
    }

    const { stream_id, chat_id } = response.value;

    const connectionStream = subscribe('chat', chat_id, stream_id);
    if (!connectionStream) {
      return { error: true };
    }

    analytics.track('ai_message_sent', {
      model: model ?? DEFAULT_MODEL,
      attachmentCount: attachments.length,
    });

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
