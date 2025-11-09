import { isErr } from '@core/util/maybeResult';
import { logger } from '@observability/logger';
import { emailClient } from '@service-email/client';
import type { MessageToSendDbId } from '@service-email/generated/schemas';
import type { MessageToSend } from '@service-email/generated/schemas/messageToSend';

export async function saveEmailDraft(
  draft: MessageToSend
): Promise<MessageToSendDbId | false> {
  const createRes = await emailClient.createDraft({ draft });
  if (isErr(createRes)) {
    logger.error(new Error('Failed to save draft', { cause: createRes[0] }));
    return false;
  }
  if (!createRes[1].draft.db_id) {
    logger.error(new Error('Draft save success but no draft id returned'));
    return false;
  }
  return createRes[1].draft.db_id;
}

export async function deleteEmailDraft(draftId: string): Promise<boolean> {
  const deleteRes = await emailClient.deleteDraft({ id: draftId });
  if (isErr(deleteRes)) {
    logger.error(new Error('Failed to delete draft', { cause: deleteRes[0] }));
    return false;
  }
  return true;
}
