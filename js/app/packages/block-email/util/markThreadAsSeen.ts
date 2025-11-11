import { isErr } from '@core/util/maybeResult';
import { logger } from '@observability';
import { emailClient } from '@service-email/client';

export async function markThreadAsSeen(threadId: string) {
  const result = await emailClient.markThreadAsSeen({
    thread_id: threadId,
  });
  if (isErr(result)) {
    logger.error('Failed to mark email thread as seen', result[0]);
  }
}
