import {
  draftContactInput,
  type GraphqlSaveEmailDraftArgs,
} from '@queries/email/graphql/draft';
import type { DraftClientHandles } from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import type { EmailDraft } from '../core/email-draft';

/** Build the complete optimistic save from the selected inbox's metadata. */
export function queuedDraftSaveArgs({
  draft,
  handles,
  senderLinkId,
  senderAccount,
  senderEmail,
}: {
  draft: EmailDraft;
  handles: DraftClientHandles & { threadId: string };
  senderLinkId: string;
  senderAccount?: { macro_id: string; draft_is_signal?: boolean };
  senderEmail: string;
}): GraphqlSaveEmailDraftArgs {
  const isNewThread = !draft.thread_db_id && !draft.replying_to_id;
  // The inbox owns its threads, including delegated inboxes. Its cached owner
  // is available independently of the viewer's user-info request.
  const newThreadOwnerId = isNewThread ? senderAccount?.macro_id : undefined;
  if (isNewThread && !newThreadOwnerId) {
    throw new Error(
      'Unable to save draft until the sending account is available.'
    );
  }
  return {
    senderIsSignal: senderAccount?.draft_is_signal,
    newThreadOwnerId,
    draftId: handles.draftId,
    threadDbId: handles.threadId,
    // Persist the selected inbox itself: the primary inbox can change before replay.
    linkId: senderLinkId || undefined,
    replyingToId: draft.replying_to_id ?? undefined,
    providerId: draft.provider_id ?? undefined,
    providerThreadId: draft.provider_thread_id ?? undefined,
    subject: draft.subject,
    to: (draft.to ?? []).map(draftContactInput),
    cc: (draft.cc ?? []).map(draftContactInput),
    bcc: (draft.bcc ?? []).map(draftContactInput),
    bodyHtml: draft.body_html ?? undefined,
    bodyText: draft.body_text ?? undefined,
    bodyMacro: draft.body_macro ?? undefined,
    senderLinkId,
    senderEmail,
    // Responses carry the body unencoded; mutation input retains base64.
    optimisticBodyHtml: draft.body_html
      ? decodeBase64Utf8(draft.body_html)
      : null,
  };
}
