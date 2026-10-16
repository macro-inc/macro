import { $isImageNode, $isVideoNode } from '@macro-inc/lexical-core';
import {
  $getRoot,
  $isElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import type {
  EmailComposeFeedback,
  EmailConnectivity,
} from '../context/compose-capabilities';
import type { DraftIdentity } from './draft-session';
import type { DraftFormAttachment } from './email-form-state';

/** Immediate GraphQL sends accept durable local handles; attachments must be uploaded. */
export type SendRefusal =
  | 'offline'
  | 'offline-attachments'
  | 'media-not-uploaded'
  | 'draft-not-saved'
  | 'draft-not-confirmed'
  | 'attachment-not-uploaded';

const SEND_REFUSAL_SUBTEXT: Record<SendRefusal, string> = {
  offline: "You're offline",
  'offline-attachments': 'Reconnect to send this email.',
  'media-not-uploaded':
    'Wait for images and videos to finish uploading, or remove them.',
  'draft-not-saved': 'Draft not saved',
  'draft-not-confirmed': 'Draft still syncing, try again',
  'attachment-not-uploaded': 'Attachment not uploaded',
};

export function refuseSend(notices: EmailComposeFeedback, reason: SendRefusal) {
  notices.feedback.failure('Failed to send email', {
    subtext: SEND_REFUSAL_SUBTEXT[reason],
  });
}

/** Legacy sending and Send Later still require connectivity. */
export function sendRefusalBeforeSave(
  connectivity: EmailConnectivity,
  queueActive = false,
  hasAttachments = false
): SendRefusal | undefined {
  if (!connectivity.looksOffline()) return;
  return hasAttachments
    ? 'offline-attachments'
    : !queueActive
      ? 'offline'
      : undefined;
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
  queueActive?: boolean;
}): SendRefusal | undefined {
  const { identity } = input;
  if (!input.autosaveAllowed) return 'draft-not-confirmed';
  if (!input.queueActive && identity.kind === 'server' && identity.queued)
    return 'draft-not-confirmed';
  if (
    !input.queueActive &&
    identity.kind === 'handle' &&
    (!input.unqueuedHandleMaySend || identity.queued)
  ) {
    return 'draft-not-confirmed';
  }
  if (
    input.attachments.some(
      (attachment) =>
        attachment.type === 'local' &&
        (!attachment.attachmentId ||
          (input.queueActive && attachment.uploaded !== true))
    )
  ) {
    return 'attachment-not-uploaded';
  }
  return undefined;
}

/** The immutable send payload must contain durable media URLs. */
export function pendingInlineMedia(editor: LexicalEditor | undefined): boolean {
  if (!editor) return false;
  return editor.read(() => {
    const pending = (node: LexicalNode): boolean => {
      if ($isImageNode(node) || $isVideoNode(node))
        return (
          node.getSrcType() === 'local' || node.getUrl().startsWith('blob:')
        );
      return $isElementNode(node) && node.getChildren().some(pending);
    };
    return pending($getRoot());
  });
}
