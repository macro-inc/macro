import { logger } from '@observability/logger';
import { emailClient } from '@service-email/client';
import type {
  ApiDraftInput,
  ApiDraftOutputDbId,
} from '@service-email/generated/schemas';

export async function saveEmailDraft(
  draft: ApiDraftInput,
  sendTime?: Date | null
): Promise<ApiDraftOutputDbId | false> {
  const createRes = await emailClient.createDraft({
    draft,
    send_time: sendTime?.toISOString() ?? null,
  });
  if (createRes.isErr()) {
    logger.error(new Error('Failed to save draft', { cause: createRes.error }));
    return false;
  }
  if (!createRes.value.draft.db_id) {
    logger.error(new Error('Draft save success but no draft id returned'));
    return false;
  }
  return createRes.value.draft.db_id;
}

export async function deleteEmailDraft(draftId: string): Promise<boolean> {
  const deleteRes = await emailClient.deleteDraft({ id: draftId });
  if (deleteRes.isErr()) {
    logger.error(
      new Error('Failed to delete draft', {
        cause: new Error(`Failed to delete draft: ${deleteRes.error}`),
      })
    );
    return false;
  }
  return true;
}
