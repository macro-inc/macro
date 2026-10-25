import { readEmailSendStatus } from '@service-storage/email-send';
import type { SendEmailAttemptInput } from '@service-storage/graphql/generated/graphql';
import { v7 as uuidV7 } from 'uuid';
import { publishDraftRestoration } from './draft-lifecycle-events';
import type { GraphqlSaveEmailDraftArgs } from './graphql/draft';
import {
  emailStorageSession,
  localDraftStore,
  persistLocalEmailSend,
  readLocalDraft,
  readLocalEmailSends,
  removeLocalEmailSend,
  watchLocalEmailSends,
} from './local-drafts';
import {
  captureSendWorkingCopy,
  retireSendWorkingCopy,
  type SendWorkingCopy,
} from './send-draft-lifecycle';
import {
  emailSendFailureKind,
  recordEmailSend,
  traceEmailSend,
} from './send-telemetry';

export type { EmailSendIntent } from './send-intent';

import { type EmailSendIntent, usableEmailSendIntents } from './send-intent';

export function settledSendAttempt(intent: EmailSendIntent) {
  return (
    intent.response?.cancelEmailSend?.attempt ??
    intent.response?.sendEmailMessage?.attempt
  );
}

/** A pending cancellation never unlocks an attempted send without confirmation. */
export function emailSendLocked(intent: EmailSendIntent): boolean {
  if (intent.locallyCancelled && !intent.metadata.requiresServerConfirmation)
    return false;
  return settledSendAttempt(intent)?.status !== 'CANCELLED';
}

export function emailSendMatchesDraft(
  intent: EmailSendIntent,
  draftId: string
): boolean {
  return (
    intent.resolvedDraftId === draftId ||
    intent.metadata.payload.input.message.draftId === draftId ||
    settledSendAttempt(intent)?.message?.id === draftId
  );
}

export async function readEmailSendIntents(): Promise<EmailSendIntent[]> {
  const rows = await readLocalEmailSends();
  return usableEmailSendIntents(rows);
}

export const watchEmailSends = watchLocalEmailSends;

export async function sendEmailQueued(args: {
  draft: GraphqlSaveEmailDraftArgs;
  expectedLocalVersion?: Pick<SendWorkingCopy, 'generation' | 'revision'>;
  attachmentIds: string[];
  forwardedAttachmentIds: string[];
  includeSignature?: boolean | null;
  signatureHtml?: string;
  restoreBodyHtml?: string | null;
  restoreBodyText?: string | null;
  restoreBodyMacro?: string | null;
}) {
  args = structuredClone(args);
  const previous = (await readEmailSendIntents()).find(
    (intent) =>
      emailSendMatchesDraft(intent, String(args.draft.draftId)) &&
      emailSendLocked(intent)
  );
  if (previous) throw new Error('This draft is already queued for sending');
  const local = await readLocalDraft(String(args.draft.draftId));
  const draft = {
    ...args.draft,
    draftId: local?.serverDraftId ?? args.draft.draftId,
    threadDbId: local?.serverThreadId ?? args.draft.threadDbId,
  };
  const workingCopy = await captureSendWorkingCopy(
    String(args.draft.draftId),
    args.attachmentIds,
    args.forwardedAttachmentIds,
    args.expectedLocalVersion
  );
  const attemptId = uuidV7();
  const input: SendEmailAttemptInput = {
    attempt: { attemptId, linkId: draft.senderLinkId },
    message: {
      draftId: draft.draftId,
      draftGeneration: draft.draftGeneration ?? 0,
      sendTime: draft.sendTime,
      threadDbId: draft.threadDbId,
      subject: draft.subject,
      linkId: draft.senderLinkId,
      senderEmail: draft.senderEmail,
      replyingToId: draft.replyingToId,
      providerId: draft.providerId,
      providerThreadId: draft.providerThreadId,
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      bodyHtml: draft.bodyHtml,
      bodyText: draft.bodyText,
      bodyMacro: draft.bodyMacro,
    },
    attachmentIds: args.attachmentIds,
    forwardedAttachmentIds: args.forwardedAttachmentIds,
    includeSignature: args.includeSignature,
    signatureHtml: args.signatureHtml,
    restoreBodyHtml: args.restoreBodyHtml ?? draft.bodyHtml,
    restoreBodyText: args.restoreBodyText ?? draft.bodyText,
    restoreBodyMacro: args.restoreBodyMacro ?? draft.bodyMacro,
  };
  const intent: EmailSendIntent = {
    uuid: attemptId,
    dispatchVersion: 2,
    phase: 'pending',
    locallyCancelled: false,
    metadata: {
      kind: 'email-send-v1',
      payload: { input, draft, workingCopy },
    },
  };
  await traceEmailSend('persist', input.attempt, () =>
    persistLocalEmailSend(intent, true)
  );
  recordEmailSend({ operation: 'enqueue', outcome: 'queued' }, intent);
  return {
    draftId: String(draft.draftId),
    threadId: draft.threadDbId,
    inboxId: draft.senderLinkId,
    sendAttemptId: attemptId,
    persistence: 'queued' as const,
  };
}

/** Cancellation must win before provider submission starts. */
export class EmailSendCancellationTooLate extends Error {
  constructor() {
    super('Delivery already started; cancellation was too late');
    this.name = 'EmailSendCancellationTooLate';
  }
}

export class EmailSendCancellationPending extends Error {
  constructor() {
    super('Cancellation is pending. Check email send status before editing.');
    this.name = 'EmailSendCancellationPending';
  }
}

export class EmailSendDeliveryUnconfirmed extends Error {
  constructor() {
    super(
      'Delivery unconfirmed; check your sent mail. We will not resend automatically.'
    );
    this.name = 'EmailSendDeliveryUnconfirmed';
  }
}

/** Returns persisted state independently of any mounted queue observer. */
export async function cancelEmailSendQueued(
  intent: EmailSendIntent
): Promise<EmailSendIntent> {
  const status = settledSendAttempt(intent)?.status;
  if (status === 'DELIVERY_UNCONFIRMED')
    throw new EmailSendDeliveryUnconfirmed();
  if (status === 'SENDING' || status === 'SENT')
    throw new EmailSendCancellationTooLate();
  return await persistLocalEmailSend({
    ...intent,
    cancellationRequested: true,
  });
}

/** Scheduled UI must not become editable merely because Cancel was queued. */
export async function cancelEmailSendAndConfirm(
  intent: EmailSendIntent
): Promise<void> {
  let current = await cancelEmailSendQueued(intent);
  const deadline = Date.now() + 15_000;
  while (true) {
    const status = settledSendAttempt(current)?.status;
    if (
      status === 'CANCELLED' ||
      (current.locallyCancelled && !current.metadata.requiresServerConfirmation)
    ) {
      await restoreCancelledEmailSend(current);
      return;
    }
    if (status === 'SENT' || status === 'SENDING')
      throw new EmailSendCancellationTooLate();
    if (status === 'DELIVERY_UNCONFIRMED')
      throw new EmailSendDeliveryUnconfirmed();
    if (Date.now() >= deadline) throw new EmailSendCancellationPending();
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
    const latest = (await readEmailSendIntents()).find(
      (row) => row.uuid === intent.uuid
    );
    if (latest) current = latest;
    else {
      // Another tab may have restored or retired it. Absence alone is not Undo.
      const attempt = await fetchEmailSendStatus(current);
      if (attempt?.status === 'CANCELLED') return;
      if (attempt?.status === 'SENT' || attempt?.status === 'SENDING')
        throw new EmailSendCancellationTooLate();
    }
  }
}

/** A status check never resubmits a message. */
export async function fetchEmailSendStatus(intent: EmailSendIntent) {
  return await readEmailSendStatus(
    intent.metadata.payload.input.attempt,
    AbortSignal.timeout(15_000)
  );
}

/** Restore the existing draft identity so uploaded and forwarded files stay attached. */
export async function restoreCancelledEmailSend(
  intent: EmailSendIntent
): Promise<void> {
  const started = performance.now();
  try {
    const result = await localDraftStore.restoreSend(
      await emailStorageSession(),
      intent.uuid
    );
    if (!result) return;
    const { draft, intent: restoredIntent } = result;
    publishDraftRestoration({
      draftId: draft.serverDraftId ?? draft.draftId,
      inboxId: draft.inboxId,
      restoration: {
        originalDraftId: String(
          restoredIntent.metadata.payload.input.message.draftId
        ),
        threadId: draft.serverThreadId ?? draft.threadId ?? draft.draftId,
        replyingToId: draft.content.replying_to_id,
        includeSignature: draft.content.include_signature,
      },
    });
    recordEmailSend(
      {
        operation: 'restore',
        outcome: 'completed',
        durationMs: performance.now() - started,
      },
      restoredIntent
    );
  } catch (error) {
    recordEmailSend(
      {
        operation: 'restore',
        outcome: 'error',
        failureKind: emailSendFailureKind(error),
        durationMs: performance.now() - started,
      },
      intent
    );
    throw error;
  }
}

/** Retire a confirmed success without discarding a newer working copy. */
export async function retireEmailSendIntent(
  intent: EmailSendIntent
): Promise<boolean> {
  const current = (await readEmailSendIntents()).find(
    (row) => row.uuid === intent.uuid
  );
  if (!current) return true;
  if (settledSendAttempt(current)?.status !== 'SENT') return false;
  await retireSendWorkingCopy(current.metadata.payload.workingCopy);
  await removeLocalEmailSend(intent.uuid);
  return true;
}

/** Manual reconciliation uses the same attempt; the app-shell runner owns retries. */
export async function recoverEmailSendIntent(
  intent: EmailSendIntent
): Promise<void> {
  await localDraftStore.requestSendCheck(
    await emailStorageSession(),
    intent.uuid
  );
}
