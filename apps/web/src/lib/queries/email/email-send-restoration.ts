import type {
  LocalDraft,
  LocalDraftAttachment,
} from '@app/features/email-compose/core/local-draft';
import type { DraftStorageSession } from './local-draft-store';
import { type EmailSendIntent, isEmailSendIntent } from './send-intent';

export type RestoredEmailSend = { draft: LocalDraft; intent: EmailSendIntent };

/**
 * Cancellation, copy restoration and authority retirement share one transaction.
 * `landed` is this call's result from an attempt the page saw abort; when the
 * send is gone and the copy still has that attempt's generation, the attempt
 * committed and its result stands.
 */
export function restoreEmailSendTransaction(
  tx: IDBTransaction,
  session: DraftStorageSession,
  uuid: string,
  finish: (result: RestoredEmailSend | Error | undefined) => void,
  landed?: RestoredEmailSend
) {
  const sends = tx.objectStore('sends');
  const request = sends.get(uuid);
  request.onsuccess = () => {
    const intent = request.result as EmailSendIntent | undefined;
    if (!intent && landed) {
      const copy = tx.objectStore('drafts').get(landed.draft.key);
      copy.onsuccess = () =>
        finish(
          (copy.result as LocalDraft | undefined)?.generation ===
            landed.draft.generation
            ? landed
            : undefined
        );
      return;
    }
    if (
      !isEmailSendIntent(intent) ||
      intent.accountId !== session.accountId ||
      intent.dispatchVersion !== 2
    ) {
      finish(undefined);
      return;
    }
    const attempt =
      intent.response?.cancelEmailSend?.attempt ??
      intent.response?.sendEmailMessage?.attempt;
    if (
      !(
        intent.locallyCancelled && !intent.metadata.requiresServerConfirmation
      ) &&
      attempt?.status !== 'CANCELLED'
    ) {
      finish(new Error('Confirm cancellation before restoring the draft'));
      return;
    }
    const { input, workingCopy: copy, draft: frozen } = intent.metadata.payload;
    const server = attempt?.message;
    const ids = new Set([
      copy?.key,
      String(input.message.draftId),
      intent.resolvedDraftId,
      server?.id,
    ]);
    const drafts = tx.objectStore('drafts');
    const read = drafts.getAll();
    read.onsuccess = () => {
      const current = (read.result as LocalDraft[]).find(
        (row) =>
          row.accountId === session.accountId &&
          [row.key, row.draftId, row.serverDraftId].some(
            (id) => id && ids.has(id)
          )
      );
      const exact =
        !!current &&
        !!copy &&
        current.key === copy.key &&
        current.generation === copy.generation &&
        current.revision === copy.revision;
      // Preserve newer contents/files, but fence saves issued before cancellation:
      // their server generation is stale and their callbacks cannot retire this copy.
      const generation = Math.max(
        current?.content.draft_generation ?? 0,
        server?.draftGeneration ?? frozen.draftGeneration ?? 0
      );
      const restored: LocalDraft =
        current && !exact
          ? {
              ...current,
              generation: crypto.randomUUID(),
              revision: current.revision + 1,
              acknowledgedRevision: 0,
              latestAttemptId: undefined,
              queuedAttemptId: undefined,
              status: 'dirty',
              errorCode: undefined,
              updatedAt: Date.now(),
              content: { ...current.content, draft_generation: generation },
            }
          : {
              key: copy?.key ?? String(frozen.draftId),
              draftId: copy?.key ?? String(frozen.draftId),
              threadId:
                server?.threadId ??
                intent.resolvedThreadId ??
                frozen.threadDbId,
              serverDraftId: server?.id ?? current?.serverDraftId,
              serverThreadId: server?.threadId ?? current?.serverThreadId,
              accountId: session.accountId,
              generation: crypto.randomUUID(),
              revision: (current?.revision ?? 0) + 1,
              acknowledgedRevision: 0,
              status: 'dirty',
              updatedAt: Date.now(),
              inboxId: frozen.senderLinkId,
              senderEmail: frozen.senderEmail,
              content: {
                draft_generation: generation,
                subject: frozen.subject,
                sender_email: frozen.senderEmail,
                to: frozen.to,
                cc: frozen.cc,
                bcc: frozen.bcc,
                replying_to_id:
                  frozen.replyingToId == null
                    ? frozen.replyingToId
                    : String(frozen.replyingToId),
                thread_db_id: server?.threadId ?? frozen.threadDbId,
                provider_id: frozen.providerId,
                provider_thread_id: frozen.providerThreadId,
                include_signature: input.includeSignature,
                body_html: input.restoreBodyHtml ?? frozen.bodyHtml,
                body_text: input.restoreBodyText ?? frozen.bodyText,
                body_macro: input.restoreBodyMacro ?? frozen.bodyMacro,
              },
              attachments: restoreAttachments(intent),
            };
      if (current)
        tx.objectStore('meta').put(true, [
          'retired',
          current.key,
          current.generation,
        ]);
      if (exact) {
        for (const attachment of current.attachments)
          if (attachment.type === 'local')
            tx.objectStore('files').delete([current.key, attachment.id]);
      }
      drafts.put({ ...restored, epoch: session.epoch }, restored.key);
      tx.objectStore('meta').put(restored.generation, [
        'generation',
        restored.key,
      ]);
      for (const id of ids) {
        if (!id) continue;
        const lock = tx.objectStore('meta').get(['send-lock', id]);
        lock.onsuccess = () => {
          if (lock.result === uuid)
            tx.objectStore('meta').delete(['send-lock', id]);
        };
      }
      sends.delete(uuid);
      finish({ draft: restored, intent });
    };
  };
}

function restoreAttachments(intent: EmailSendIntent): LocalDraftAttachment[] {
  const copy = intent.metadata.payload.workingCopy;
  if (copy)
    return copy.attachments.map((file) => {
      if (file.type !== 'local') return file;
      if (!file.attachmentId || !file.uploaded)
        throw new Error('Approved attachment is incomplete');
      return {
        type: 'remote' as const,
        attachmentId: file.attachmentId,
        fileName: file.name,
        fileSize: file.size,
        contentType: file.mimeType,
        url: '',
      };
    });
  const message =
    (
      intent.response?.cancelEmailSend?.attempt ??
      intent.response?.sendEmailMessage?.attempt
    )?.message ?? intent.metadata.payload.draft.existingDraft;
  return [
    ...(message?.attachmentsDraft ?? []).map((file) => ({
      type: 'remote' as const,
      attachmentId: file.id,
      fileName: file.fileName,
      fileSize: file.size,
      contentType: file.contentType,
      url: '',
    })),
    ...(message?.attachmentsForwarded ?? []).map((file) => ({
      type: 'forwarded' as const,
      attachmentId: file.attachmentId,
      fileName: file.filename ?? 'Attachment',
      mimeType: file.mimeType ?? 'application/octet-stream',
      fileSize: file.sizeBytes ?? 0,
    })),
    ...(message?.attachments ?? []).map((file) => ({
      type: 'native' as const,
      attachmentId: file.id,
      fileName: file.filename ?? 'Attachment',
      mimeType: file.mimeType ?? 'application/octet-stream',
      fileSize: file.sizeBytes ?? 0,
      referenceUrl: file.referenceUrl,
    })),
  ];
}
