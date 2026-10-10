import { decodeBase64Utf8 } from '@app/features/email-compose/core/decode-base64';
import type { LocalDraft } from '@app/features/email-compose/core/local-draft';
import type { DraftFormAttachment } from '@app/features/email-compose/primitives/email-form-state';
import { Telemetry } from '@macro-inc/observability';
import {
  draftContactInput,
  type GraphqlSaveEmailDraftArgs,
} from './graphql/draft';
import {
  forgetLocalDraft,
  readLocalDraft,
  resumeLocalDraft,
  reviveLocalDraft,
  saveLocalDraft,
} from './local-drafts';
import type { EmailSendIntent } from './send-queue';

export type SendRestorationVersion = Pick<
  LocalDraft,
  'key' | 'generation' | 'revision'
>;

/** The working-copy lifetime handed to the durable send journal; no file blobs. */
export type SendWorkingCopy = Pick<
  LocalDraft,
  'key' | 'generation' | 'revision' | 'attachments'
>;

export async function captureSendWorkingCopy(
  draftId: string,
  attachmentIds: readonly string[],
  forwardedAttachmentIds: readonly string[],
  expected?: Pick<LocalDraft, 'generation' | 'revision'>
): Promise<SendWorkingCopy | undefined> {
  const local = await readLocalDraft(draftId);
  if (
    (local || expected) &&
    (!local ||
      !expected ||
      local.generation !== expected.generation ||
      local.revision !== expected.revision)
  )
    throw new Error(
      'This draft changed while preparing the send. Reopen it to review the latest version.'
    );
  if (!local) return;
  if (local.status === 'deleting' || local.status === 'delete-failed')
    throw new Error('Resolve the draft deletion before sending');
  if (local.attachments.some((a) => a.type === 'local' && !a.uploaded))
    throw new Error('Finish uploading attachments before sending');
  const uploaded = new Set(attachmentIds);
  const forwarded = new Set(forwardedAttachmentIds);
  if (
    local.attachments.some(
      (a) =>
        !a.attachmentId ||
        !(a.type === 'forwarded' ? forwarded : uploaded).delete(a.attachmentId)
    ) ||
    uploaded.size ||
    forwarded.size
  )
    throw new Error('Attachments changed while preparing this send');
  return {
    key: local.key,
    generation: local.generation,
    revision: local.revision,
    attachments: local.attachments,
  };
}

/** A cleanup failure cannot turn an already accepted send into a failed send. */
export async function retireSendWorkingCopy(copy: SendWorkingCopy | undefined) {
  if (!copy) return;
  try {
    await forgetLocalDraft(copy.key, copy);
  } catch (error) {
    Telemetry.error(error instanceof Error ? error : new Error(String(error)));
  }
}

function restoredAttachments(
  draft: GraphqlSaveEmailDraftArgs,
  copy: SendWorkingCopy | undefined
): DraftFormAttachment[] {
  if (copy)
    return copy.attachments.map((attachment) => {
      if (attachment.type !== 'local') return attachment;
      if (!attachment.uploaded || !attachment.attachmentId)
        throw new Error('The queued attachment has no completed upload');
      return {
        type: 'remote',
        attachmentId: attachment.attachmentId,
        fileName: attachment.name,
        contentType: attachment.mimeType,
        fileSize: attachment.size,
        url: '',
      };
    });
  return [
    ...(draft.existingDraft?.attachmentsDraft ?? []).map((attachment) => ({
      type: 'remote' as const,
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      fileSize: attachment.size,
      url: '',
    })),
    ...(draft.existingDraft?.attachmentsForwarded ?? []).map((attachment) => ({
      type: 'forwarded' as const,
      attachmentId: attachment.attachmentId,
      fileName: attachment.filename ?? 'Attachment',
      mimeType: attachment.mimeType ?? 'application/octet-stream',
      fileSize: attachment.sizeBytes ?? 0,
    })),
  ];
}

/** Explicit cancellation restores local durability before another save can replay. */
export async function restoreSendWorkingCopy(
  draft: GraphqlSaveEmailDraftArgs,
  copy: SendWorkingCopy | undefined
): Promise<
  GraphqlSaveEmailDraftArgs & {
    restorationVersion: SendRestorationVersion;
  }
> {
  if (copy) await forgetLocalDraft(copy.key, copy);
  let local = await readLocalDraft(copy?.key ?? String(draft.draftId));
  if (local) {
    // Keep newer edits, but fence old send-time callbacks before resuming them.
    await resumeLocalDraft(local.key, copy?.generation);
    local = (await readLocalDraft(local.key)) ?? local;
  } else {
    const draftId = copy?.key ?? String(draft.draftId);
    await reviveLocalDraft(draftId);
    local = await saveLocalDraft({
      clientHandles: { draftId, threadId: draft.threadDbId },
      inboxId: draft.senderLinkId,
      senderEmail: draft.senderEmail,
      draft: {
        subject: draft.subject,
        to: draft.to,
        cc: draft.cc,
        bcc: draft.bcc,
        body_html: draft.bodyHtml,
        body_text: draft.bodyText,
        body_macro: draft.bodyMacro,
        replying_to_id:
          draft.replyingToId == null
            ? draft.replyingToId
            : String(draft.replyingToId),
        provider_id: draft.providerId,
        provider_thread_id: draft.providerThreadId,
        thread_db_id: draft.threadDbId,
      },
      attachments: restoredAttachments(draft, copy),
    });
  }
  return {
    ...draft,
    restorationVersion: {
      key: local.key,
      generation: local.generation,
      revision: local.revision,
    },
    draftId: local.draftId,
    threadDbId: local.serverThreadId ?? local.threadId ?? draft.threadDbId,
    localRevision: local.revision,
    senderLinkId: local.inboxId ?? draft.senderLinkId,
    linkId: local.inboxId ?? draft.linkId,
    senderEmail: local.senderEmail ?? draft.senderEmail,
    subject: local.content.subject,
    to: local.content.to?.map(draftContactInput),
    cc: local.content.cc?.map(draftContactInput),
    bcc: local.content.bcc?.map(draftContactInput),
    replyingToId: local.content.replying_to_id,
    providerId: local.content.provider_id,
    providerThreadId: local.content.provider_thread_id,
    bodyHtml: local.content.body_html,
    bodyText: local.content.body_text,
    bodyMacro: local.content.body_macro,
    optimisticBodyHtml: local.content.body_html
      ? decodeBase64Utf8(local.content.body_html)
      : null,
  };
}

/** A newer acknowledged edit makes an obsolete restoration safe to retire. */
export async function supersededSendRestoration(
  intent: EmailSendIntent
): Promise<boolean> {
  const { restoring, restorationVersion } = intent.metadata.payload;
  if (!restoring || intent.phase !== 'failed' || !restorationVersion)
    return false;
  const local = await readLocalDraft(restorationVersion.key);
  return (
    local?.generation === restorationVersion.generation &&
    local.acknowledgedRevision > restorationVersion.revision
  );
}
