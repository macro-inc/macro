import { throwOnErr } from '@core/util/result';
import { emailClient } from '@service-email/client';
import { cancelSequenceDraft } from '@service-email/sequence-cancellation';
import type { SequenceDelivery } from '../context/contracts';

export function createGmailSequenceDelivery(): SequenceDelivery {
  return {
    async createDraft(senderId, email, subject, body) {
      const result = await throwOnErr(() =>
        emailClient.createDraft(
          {
            draft: {
              subject,
              body_text: body,
              to: [{ email }],
              include_signature: false,
            },
          },
          senderId
        )
      );
      if (!result.draft.db_id)
        throw new Error('Gmail did not return a draft ID.');
      return result.draft.db_id;
    },
    async schedule(senderId, draftId, sendAt) {
      await throwOnErr(() =>
        emailClient.scheduleMessage(
          { draftID: draftId, send_time: sendAt, include_signature: false },
          senderId
        )
      );
    },
    async cancel(senderId, draftId) {
      const result = await cancelSequenceDraft(senderId, draftId);
      if (
        result.isErr() &&
        result.error.every((error) => error.code === 'DELIVERY_STARTED')
      )
        return 'delivery_started';
      if (
        result.isErr() &&
        !result.error.every((error) => error.code === 'NOT_FOUND')
      )
        throw new Error(result.error.map((error) => error.message).join('; '));
      // A missing scheduled record means there is no remaining queued send.
      // Delete only drafts; the endpoint will not delete a sent message.
      const deleted = await emailClient.deleteDraft({ id: draftId }, senderId);
      if (
        deleted.isErr() &&
        !deleted.error.every((error) => error.code === 'NOT_FOUND')
      )
        throw new Error(deleted.error.map((error) => error.message).join('; '));
      return 'canceled';
    },
  };
}
