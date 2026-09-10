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
  EmailComposeContext,
} from './context/compose-capabilities';
import { readDroppedEmailFiles } from './editor-adapter';
import { makeAttachmentPublic } from './make-attachment-public';
import { createEmailInboxSource } from './queries/inbox-source';
import { restoreDraftBodyAfterUndo, runUndoSend } from './undo-send';

/** Construct under the composing surface's Solid owner to scope request progress. */
export function createEmailComposeContext(): EmailComposeContext {
  const accounts = useEmailLinksQuery();
  const headerId = useNonPrimaryEmailLinkIdHeader();
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
  const reportError = (error: unknown) =>
    Telemetry.error(error instanceof Error ? error : new Error(String(error)));
  return {
    recipientName: (id) => getDisplayName(tryMacroId(id)),
    recordMention: (sourceId, targetId) => {
      void trackMention(sourceId, 'document', targetId).catch(reportError);
    },
    accounts: {
      ...inboxSource,
      primaryId: usePrimaryEmailLinkId(),
    },
    viewerEmail,
    recipients: users,
    hasPaidAccess: useHasPaidAccess(),
    presentation: {
      viewerLoading: user.isLoading,
      prepareSignatureLinks: interceptMailtoLinks,
      onUpgrade: () => paywall.showPaywall(PaywallKey.REMOVE_SIGNATURE),
      isTouch: isTouchDevice,
      isMobile,
      scheduleEnabled: ENABLE_EMAIL_SCHEDULED_SEND,
      signaturesEnabled: () => signatures().enabled,
    },
    editorFiles: {
      readDroppedFiles: readDroppedEmailFiles,
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
    },
    notices: {
      feedback: {
        success: (message, options) => toast.success(message, notice(options)),
        failure: (message, options) => toast.failure(message, notice(options)),
        alert: (message, options) => toast.alert(message, notice(options)),
        dismiss: toast.dismiss,
      },
      reportError,
    },
    drafts: {
      async saveDraft({
        completingThread,
        previousThreadId,
        inboxId,
        ...input
      }) {
        const result = await save.mutateAsync({
          ...input,
          linkId: headerId(inboxId),
          skipSoupRefetch: completingThread,
        });
        try {
          const threadId = result.draft.thread_db_id;
          if (threadId) markThreadDraftSaved(threadId);
          if (previousThreadId && previousThreadId !== threadId) {
            markThreadDraftSaved(previousThreadId);
            invalidateSoupEntity(previousThreadId);
            void refetchSoupEntity(previousThreadId, 'emailThread').catch(
              reportError
            );
          }
        } catch (error) {
          reportError(error);
        }
        return {
          draftId: result.draft.db_id ?? undefined,
          threadId: result.draft.thread_db_id ?? undefined,
          inboxId: result.draft.link_id,
        };
      },
      async deleteDraft({ completingThread, inboxId, ...input }) {
        await remove.mutateAsync({
          ...input,
          linkId: headerId(inboxId),
          skipSoupRefetch: completingThread,
        });
        try {
          if (input.threadId) markThreadDraftSaved(input.threadId);
        } catch (error) {
          reportError(error);
        }
      },
      async restoreDraft({ threadId, draftId, draft, html, inboxId }) {
        if (threadId && !isFeatureEnabled(enableGraphqlSoup)) {
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
        }
        if (draft && html !== undefined)
          await restoreDraftBodyAfterUndo(draft, html, headerId(inboxId));
        if (threadId && isFeatureEnabled(enableGraphqlSoup))
          void fetchAndCacheThread(threadId);
      },
    },
    delivery: {
      async sendMessage({ completingThread, inboxId, ...input }) {
        const result = await send.mutateAsync({
          ...input,
          linkId: headerId(inboxId),
          skipSoupRefetch: completingThread,
        });
        try {
          if (result.message.thread_db_id)
            markThreadDraftSaved(result.message.thread_db_id);
        } catch (error) {
          reportError(error);
        }
        return {
          draftId: result.message.db_id ?? undefined,
          threadId: result.message.thread_db_id ?? undefined,
          inboxId: result.message.link_id,
        };
      },
      async unschedule({ draftId, inboxId }) {
        await unschedule.mutateAsync({
          draftID: draftId,
          linkId: headerId(inboxId),
        });
        try {
          invalidateSoupEntity(draftId);
        } catch (error) {
          reportError(error);
        }
      },
      schedule: async ({ draftId, sendTime }, inboxId) => {
        await scheduleEmailMessage(
          { draftID: draftId, send_time: sendTime },
          headerId(inboxId)
        );
      },
      archive: async ({ threadId, value }, inboxId) => {
        await archiveEmailThread({ id: threadId, value }, headerId(inboxId));
      },
      undoSend: (input) =>
        runUndoSend({
          draftId: input.draftId,
          linkId: headerId(input.inboxId),
          onUndone: async () => {
            await input.onUndone();
            if (input.threadId)
              void refetchSoupEntity(input.threadId, 'emailThread');
          },
        }),
    },
    attachmentStorage: {
      uploadAttachments: ({ draftId, inboxId, ...input }) =>
        upload.mutateAsync({
          ...input,
          draftID: draftId,
          linkId: headerId(inboxId),
        }),
      addForwardedAttachments: ({ draftId, attachments, inboxId }) =>
        forward.mutateAsync({
          draftID: draftId,
          attachments: attachments.map(({ attachmentId }) => ({
            attachmentID: attachmentId,
          })),
          linkId: headerId(inboxId),
        }),
      removeAttachment: ({ draftId, attachmentId, inboxId }) =>
        removeAttachment.mutateAsync({
          draftID: draftId,
          attachmentID: attachmentId,
          linkId: headerId(inboxId),
        }),
      removeForwardedAttachment: ({ draftId, attachmentId, inboxId }) =>
        removeForwarded.mutateAsync({
          draftID: draftId,
          attachmentID: attachmentId,
          linkId: headerId(inboxId),
        }),
    },
  };
}
