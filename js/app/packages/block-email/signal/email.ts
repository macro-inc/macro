import { toast } from '@core/component/Toast/Toast';
import { isErr, isOk } from '@core/util/maybeResult';
import { logger } from '@observability';
import { emailClient } from '@service-email/client';
import type { MessageToSend } from '@service-email/generated/schemas/messageToSend';

export async function sendEmail(
  message: MessageToSend
): Promise<ReturnType<typeof emailClient.sendMessage>> {
  const sendResponse = await emailClient.sendMessage({
    message,
  });
  if (isOk(sendResponse)) {
    toast.success('Email sent');
  } else {
    toast.failure('Email failed to send');
    console.error('Email failed to send');
  }
  return sendResponse;
}

export async function markThreadAsSeen(threadId: string) {
  const result = await emailClient.markThreadAsSeen({
    thread_id: threadId,
  });
  if (isErr(result)) {
    logger.error('Failed to mark email thread as seen', result[0]);
  }
}
