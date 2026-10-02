import type { EmailDraft } from './email-draft';

/** A recoverable working copy, independent of any network mutation. */
export type LocalDraftStatus =
  | 'dirty'
  | 'queued'
  | 'synced'
  | 'failed'
  | 'unconfirmed'
  | 'deleting'
  | 'delete-failed';

export type LocalDraftAttachment =
  | {
      type: 'local';
      id: string;
      name: string;
      mimeType: string;
      size: number;
      lastModified: number;
      attachmentId?: string;
      uploaded: boolean;
    }
  | {
      type: 'remote';
      url: string;
      fileName: string;
      contentType: string;
      attachmentId: string;
      fileSize: number;
    }
  | {
      type: 'forwarded';
      attachmentId: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
    };

export type LocalDraft = {
  key: string;
  accountId: string;
  generation: string;
  revision: number;
  acknowledgedRevision: number;
  latestAttemptId?: string;
  queuedAttemptId?: string;
  draftId: string;
  threadId?: string;
  serverDraftId?: string;
  serverThreadId?: string;
  inboxId?: string;
  senderEmail?: string;
  content: EmailDraft;
  attachments: LocalDraftAttachment[];
  status: LocalDraftStatus;
  errorCode?: string;
  updatedAt: number;
};

/** Opaque to the normalized cache; only the email adapter interprets it. */
export type DraftAttempt = {
  kind: 'email-draft';
  id: string;
  draftKey: string;
  accountId: string;
  generation: string;
  revision: number;
  operation: 'save' | 'delete';
};

/** Presentation of local persistence and explicit server recovery. */
export type DraftSyncViewState = {
  message: string;
  detail?: string;
  failed: boolean;
  action?: 'save' | 'retry' | 'retry-discard';
  canDiscard: boolean;
  canKeepEditing: boolean;
};

/** Immediate and scheduled delivery must both wait for the latest local intent. */
export function localDraftReadyForDelivery(draft: LocalDraft): boolean {
  return (
    draft.acknowledgedRevision >= draft.revision &&
    !['failed', 'unconfirmed', 'delete-failed', 'deleting'].includes(
      draft.status
    ) &&
    !draft.attachments.some(
      (attachment) => attachment.type === 'local' && !attachment.uploaded
    )
  );
}
