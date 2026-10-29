import { decodeBase64Utf8 } from '@app/features/email-compose/core/decode-base64';
import { cancelEmailSend } from '@service-storage/email-send';
import { publishDraftRestoration } from './draft-lifecycle-events';
import { restoreSendWorkingCopy } from './send-draft-lifecycle';
import {
  refreshServerEmailSends,
  type ServerEmailSend,
  serverSendAccount,
} from './server-sends';

/** Other devices already handed off delivery. Cancellation uses that same authority. */
export async function cancelServerEmailSend(row: ServerEmailSend) {
  const account = serverSendAccount();
  if (!account) throw new Error('Sign in to cancel this send');
  const result = await cancelEmailSend(
    {
      attemptId: row.attempt.attemptId,
      linkId: row.linkId,
    },
    AbortSignal.timeout(15_000)
  );
  if (serverSendAccount() !== account) return;
  if (result.status !== 'CANCELLED') {
    await refreshServerEmailSends();
    throw new Error(
      result.status === 'DELIVERY_UNCONFIRMED'
        ? 'Delivery is unconfirmed. Check sent mail before taking further action.'
        : 'Delivery has already started; cancellation was too late.'
    );
  }
  const message = result.message;
  if (message) {
    if (serverSendAccount() !== account) return;
    const restored = await restoreSendWorkingCopy(
      {
        draftId: message.id,
        draftGeneration: message.draftGeneration,
        threadDbId: message.threadId,
        senderLinkId: row.linkId,
        senderEmail: message.from?.email ?? '',
        subject: message.subject ?? '',
        to: message.to,
        cc: message.cc,
        bcc: message.bcc,
        replyingToId: message.replyingToId,
        providerId: message.providerId,
        bodyHtml: message.bodyHtmlSanitized,
        bodyText: message.bodyText,
        bodyMacro: message.bodyMacro,
        optimisticBodyHtml: message.bodyHtmlSanitized
          ? decodeBase64Utf8(message.bodyHtmlSanitized)
          : null,
        existingDraft: message,
      },
      undefined,
      true
    );
    publishDraftRestoration({
      draftId: String(restored.draftId),
      inboxId: row.linkId,
      restoration: {
        originalDraftId: message.id,
        threadId: message.threadId,
        replyingToId: message.replyingToId,
      },
    });
  }
  await refreshServerEmailSends();
}
