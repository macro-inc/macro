import type {
  EmailComposeFeedback,
  EmailConnectivity,
} from '../context/compose-capabilities';
import type { DraftIdentity } from './draft-session';
import type { DraftFormAttachment } from './email-form-state';

/**
 * Why an immediate send cannot proceed. Send is a REST call that resolves
 * server ids only and is never queued (it moves onto the durable queue in a
 * later change), so it needs the device online, a draft the server can
 * address, and every attachment uploaded.
 */
export type SendRefusal =
  | 'offline'
  | 'draft-not-saved'
  | 'draft-not-confirmed'
  | 'attachment-not-uploaded';

const SEND_REFUSAL_SUBTEXT: Record<SendRefusal, string> = {
  offline: "You're offline",
  'draft-not-saved': 'Draft not saved',
  'draft-not-confirmed': 'Draft still syncing, try again',
  'attachment-not-uploaded': 'Attachment not uploaded',
};

export function refuseSend(notices: EmailComposeFeedback, reason: SendRefusal) {
  notices.feedback.failure('Failed to send email', {
    subtext: SEND_REFUSAL_SUBTEXT[reason],
  });
}

/** Offline, the pre-send save could only queue; refuse before it runs. */
export function sendRefusalBeforeSave(
  connectivity: EmailConnectivity
): SendRefusal | undefined {
  return connectivity.looksOffline() ? 'offline' : undefined;
}

/**
 * After the pre-send save: a queued-only handle cannot be addressed over
 * REST, and a local attachment without a record did not upload (its upload
 * already reported itself). A standalone compose may still send a draft
 * whose REST save failed before anything was queued or rejected.
 */
export function sendRefusalAfterSave(input: {
  identity: DraftIdentity;
  autosaveAllowed: boolean;
  attachments: readonly DraftFormAttachment[];
  unqueuedHandleMaySend: boolean;
}): SendRefusal | undefined {
  const { identity } = input;
  if (!input.autosaveAllowed) return 'draft-not-confirmed';
  if (identity.kind === 'server' && identity.queued)
    return 'draft-not-confirmed';
  if (
    identity.kind === 'handle' &&
    (!input.unqueuedHandleMaySend || identity.queued)
  ) {
    return 'draft-not-confirmed';
  }
  if (
    input.attachments.some(
      (attachment) => attachment.type === 'local' && !attachment.attachmentId
    )
  ) {
    return 'attachment-not-uploaded';
  }
  return undefined;
}
