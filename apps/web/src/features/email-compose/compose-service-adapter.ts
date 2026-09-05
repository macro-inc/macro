import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHasPaidAccess } from '@core/auth';
import {
  createFilesReadyHandler,
  getDragDropPosition,
} from '@core/component/LexicalMarkdown/utils/fileUploadUtils';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_EMAIL_SCHEDULED_SEND,
  enableEmailSignatures,
  enableGraphqlSoup,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { PaywallKey, usePaywallState } from '@core/constant/PaywallState';
import { useEmail, useUserContext } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { trackMention } from '@core/signal/mention';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { getDisplayName, tryMacroId } from '@core/user';
import { interceptMailtoLinks } from '@core/util/interceptMailtoLinks';
import { handleFileFolderDrop } from '@core/util/upload';
import { Telemetry } from '@macro-inc/observability';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { queryClient } from '@queries/client';
import {
  useAddForwardedAttachmentsMutation,
  useRemoveDraftAttachmentMutation,
  useRemoveForwardedAttachmentMutation,
  useUploadDraftAttachmentsMutation,
} from '@queries/email/attachment';
import {
  useDeleteDraftMutation,
  useSaveDraftMutation,
} from '@queries/email/draft';
import { markThreadDraftSaved } from '@queries/email/draft-cache';
import {
  archiveEmailThread,
  scheduleEmailMessage,
} from '@queries/email/integration';
import { emailKeys } from '@queries/email/keys';
import {
  useEmailLinksQuery,
  useNonPrimaryEmailLinkIdHeader,
  usePrimaryEmailLinkId,
} from '@queries/email/link';
import {
  fetchAndCacheThread,
  useSendMessageMutation,
  useUnscheduleMessageMutation,
} from '@queries/email/thread';
import { invalidateSoupEntity, refetchSoupEntity } from '@queries/soup/cache';
import type { ApiThread } from '@service-email/generated/schemas';
import type { InfiniteData } from '@tanstack/solid-query';
import type {
  ComposeNoticeOptions,
  EmailComposeServices,
} from './context/compose-services';
import { readDroppedEmailFiles } from './editor-adapter';
import { makeAttachmentPublic } from './make-attachment-public';
import { createEmailInboxSource } from './queries/inbox-source';
import { restoreDraftBodyAfterUndo, runUndoSend } from './undo-send';

/** Construct under the composing surface's Solid owner to scope request progress. */
export function createEmailComposeServices(): EmailComposeServices {
  const accounts = useEmailLinksQuery();
  const user = useUserContext();
  const paywall = usePaywallState();
  const viewerEmail = useEmail();
  const inboxSource = createEmailInboxSource(viewerEmail, accounts, (email) =>
    getDisplayName(tryMacroId(`macro|${email}`))
  );
  const signatures = useFeatureFlag(enableEmailSignatures);
  const save = useSaveDraftMutation();
  const remove = useDeleteDraftMutation();
  const send = useSendMessageMutation();
  const upload = useUploadDraftAttachmentsMutation();
  const forward = useAddForwardedAttachmentsMutation();
  const removeAttachment = useRemoveDraftAttachmentMutation();
  const removeForwarded = useRemoveForwardedAttachmentMutation();
  const unschedule = useUnscheduleMessageMutation();
  const { users } = useCombinedRecipients();
  const notice = (options?: ComposeNoticeOptions) => ({
    ...options,
    actions: options?.actions?.map((action) => ({
      ...action,
      icon: ArrowCounterClockwise,
    })),
  });
  return {
    viewerLoading: user.isLoading,
    prepareSignatureLinks: interceptMailtoLinks,
    onUpgrade: () => paywall.showPaywall(PaywallKey.REMOVE_SIGNATURE),
    readDroppedFiles: readDroppedEmailFiles,
    feedback: {
      success: (message, options) => toast.success(message, notice(options)),
      failure: (message, options) => toast.failure(message, notice(options)),
      alert: (message, options) => toast.alert(message, notice(options)),
      dismiss: toast.dismiss,
    },
    reportError: (error) =>
      Telemetry.error(
        error instanceof Error ? error : new Error(String(error))
      ),
    isTouch: isTouchDevice,
    isMobile,
    scheduleEnabled: ENABLE_EMAIL_SCHEDULED_SEND,
    recipientName: (id) => getDisplayName(tryMacroId(id)),
    recordMention: (sourceId, targetId) =>
      trackMention(sourceId, 'document', targetId),
    makePublic: makeAttachmentPublic,
    uploadEditorFiles(input) {
      if (!input.editor) return;
      handleFileFolderDrop(
        input.files,
        input.directories,
        createFilesReadyHandler(
          input.editor,
          input.sourceId,
          input.sourceId ? 'email' : undefined,
          input.dropEvent && input.editor
            ? () => getDragDropPosition(input.editor!, input.dropEvent!, true)
            : undefined,
          input.onUploaded,
          { width: 542, height: 542 }
        )
      );
    },
    accounts: {
      ...inboxSource,
      primaryId: usePrimaryEmailLinkId(),
      headerId: useNonPrimaryEmailLinkIdHeader(),
    },
    viewerEmail,
    recipients: users,
    signaturesEnabled: () => signatures().enabled,
    hasPaidAccess: useHasPaidAccess(),
    saveDraft: (input) => save.mutateAsync(input),
    deleteDraft: (input) => remove.mutateAsync(input),
    sendMessage: (input) => send.mutateAsync(input),
    uploadAttachments: (input) => upload.mutateAsync(input),
    addForwardedAttachments: (input) => forward.mutateAsync(input),
    removeAttachment: (input) => removeAttachment.mutateAsync(input),
    removeForwardedAttachment: (input) => removeForwarded.mutateAsync(input),
    unschedule: (input) => unschedule.mutateAsync(input),
    schedule: async (input, linkId) => {
      await scheduleEmailMessage(input, linkId);
    },
    archive: async (input, linkId) => {
      await archiveEmailThread(input, linkId);
    },
    markDraftSaved: markThreadDraftSaved,
    prepareUndo(threadId, draftId) {
      if (isFeatureEnabled(enableGraphqlSoup)) return;
      queryClient.setQueryData<InfiniteData<ApiThread>>(
        emailKeys.threadMessages(threadId).queryKey,
        (old) =>
          old
            ? {
                ...old,
                pages: old.pages.map((page) => ({
                  ...page,
                  messages: page.messages.filter(
                    (message) => message.db_id !== draftId
                  ),
                })),
              }
            : old
      );
      markThreadDraftSaved(threadId);
    },
    refreshAfterUndo(threadId) {
      if (isFeatureEnabled(enableGraphqlSoup))
        void fetchAndCacheThread(threadId);
    },
    refreshThreadPreview(threadId) {
      void refetchSoupEntity(threadId, 'emailThread');
    },
    invalidatePreview: invalidateSoupEntity,
    undoSend: runUndoSend,
    restoreDraft: restoreDraftBodyAfterUndo,
  };
}
