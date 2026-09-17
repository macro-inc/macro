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
  type ThreadQueryTransport,
  useSendMessageMutation,
  useUnscheduleMessageMutation,
} from '@queries/email/thread';
import {
  invalidateAllSoup,
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/cache';
import type { ApiThread } from '@service-email/generated/schemas';
import {
  draftContactInput,
  executeGraphqlDeleteEmailDraft,
  executeGraphqlSaveEmailDraft,
  type SaveEmailDraftFailureCode,
} from '@service-storage/graphql-email-draft';
import {
  getGraphqlSoupClient,
  graphqlCacheEnabled,
} from '@service-storage/graphql-soup';
import type { InfiniteData } from '@tanstack/solid-query';
import { confirmDialog } from '@ui';
import { type Accessor, getOwner } from 'solid-js';
import {
  type ComposeNoticeOptions,
  type DraftClientHandles,
  DraftPersistRejected,
  type EmailComposeContext,
  type PersistedEmailIdentity,
  type SaveEmailDraft,
} from './context/compose-capabilities';
import { decodeBase64Utf8 } from './core/decode-base64';
import type { EmailDraft } from './core/email-draft';
import { readDroppedEmailFiles } from './editor-adapter';
import { makeAttachmentPublic } from './make-attachment-public';
import { createEmailInboxSource } from './queries/inbox-source';
import { restoreDraftBodyAfterUndo, runUndoSend } from './undo-send';

export type EmailComposeContextOptions = {
  /**
   * Transport of the thread read this composer sits under. Reply drafts
   * follow it (see `queueDrafts`); a compose surface has none.
   */
  threadTransport?: Accessor<ThreadQueryTransport | undefined>;
};

/** Construct under the composing surface's Solid owner to scope request progress. */
export function createEmailComposeContext(
  options: EmailComposeContextOptions = {}
): EmailComposeContext {
  const accounts = useEmailLinksQuery();
  const headerId = useNonPrimaryEmailLinkIdHeader();
  const primaryId = usePrimaryEmailLinkId();
  // Attach handlers run as event handlers, which have no Solid owner of
  // their own; the dialog needs the surface's.
  const dialogOwner = getOwner();
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

  // Draft saves and deletes can ride the durable GraphQL mutation queue:
  // offline they persist locally and replay as idempotent upserts keyed by
  // client handles. They must use the SAME transport the surface's thread
  // read used — a queued save against a REST-read thread has no cached
  // page for its optimistic patch, so the draft would be durable but
  // invisible offline. Replies follow the thread query's transport; compose
  // drafts follow the soup flag. The uncached fallback client has no queue,
  // so REST remains the fallback there.
  const queueTransportActive = () =>
    graphqlCacheEnabled() &&
    (options.threadTransport
      ? options.threadTransport() === 'graphql'
      : isFeatureEnabled(enableGraphqlSoup));
  // The queue keys a save by draft and thread ids: the composer's minted
  // handles, or the server ids of a confirmed draft (a server id resolves as
  // its own handle). Without both, the save stays on REST.
  const queueHandles = (
    input: SaveEmailDraft
  ): DraftClientHandles | undefined => {
    if (!queueTransportActive()) return undefined;
    if (input.clientHandles?.threadId) return input.clientHandles;
    const { db_id, thread_db_id } = input.draft;
    return db_id && thread_db_id
      ? { draftId: db_id, threadId: thread_db_id }
      : undefined;
  };

  // Deterministic rejections are the composer's to interpret; transport
  // failures reject plainly and the next save may retry them.
  const persistRejection = (
    code: SaveEmailDraftFailureCode,
    message: string,
    threadId: string | undefined
  ): Error => {
    if (code === 'NETWORK') {
      toast.failure(message);
      return new Error(`${message}: network`);
    }
    if (code === 'DRAFT_ALREADY_SENT') {
      // The composer drops its draft; show the thread's real state.
      if (threadId) {
        try {
          markThreadDraftSaved(threadId);
          invalidateSoupEntity(threadId);
          void refetchSoupEntity(threadId, 'emailThread').catch(reportError);
          void fetchAndCacheThread(threadId);
        } catch (error) {
          reportError(error);
        }
      }
    } else {
      toast.failure(message);
      reportError(new Error(`${message}: ${code}`));
    }
    return new DraftPersistRejected(code);
  };

  async function saveDraftQueued(
    draft: EmailDraft,
    handles: DraftClientHandles & { threadId: string },
    inboxId: string | undefined,
    completingThread: boolean | undefined,
    previousThreadId: string | undefined
  ): Promise<PersistedEmailIdentity> {
    const senderLinkId = inboxId ?? primaryId() ?? '';
    const senderEmail =
      inboxSource.inboxes().find((inbox) => inbox.id === senderLinkId)
        ?.email_address ??
      viewerEmail() ??
      '';
    const outcome = await executeGraphqlSaveEmailDraft(getGraphqlSoupClient(), {
      draftId: handles.draftId,
      threadDbId: handles.threadId,
      linkId: headerId(inboxId),
      replyingToId: draft.replying_to_id ?? undefined,
      providerId: draft.provider_id ?? undefined,
      providerThreadId: draft.provider_thread_id ?? undefined,
      subject: draft.subject,
      to: (draft.to ?? []).map(draftContactInput),
      cc: (draft.cc ?? []).map(draftContactInput),
      bcc: (draft.bcc ?? []).map(draftContactInput),
      bodyHtml: draft.body_html ?? undefined,
      // Client-only: feeds the optimistic draft entity so the thread shows
      // this save while it is still queued. Responses carry the body
      // unencoded, so decode the prepared base64 body.
      senderLinkId,
      senderEmail,
      optimisticBodyHtml: draft.body_html
        ? decodeBase64Utf8(draft.body_html)
        : null,
    });
    if (outcome.kind === 'failed') {
      throw persistRejection(
        outcome.code,
        'Failed to save draft',
        handles.threadId
      );
    }
    if (outcome.kind === 'queued') {
      // Durably accepted locally under the caller's handles. Cache
      // bookkeeping waits for the commit, whose persisted revalidation
      // reconciles the thread.
      return {
        draftId: handles.draftId,
        threadId: handles.threadId,
        inboxId: senderLinkId,
        persistence: 'queued',
      };
    }
    // The server may converge onto another draft or re-home the thread;
    // the committed ids are the answer. Keep the REST-facade caches honest
    // during the transport rollout, matching useSaveDraftMutation's
    // onSuccess effects.
    try {
      markThreadDraftSaved(outcome.threadId);
      if (previousThreadId && previousThreadId !== outcome.threadId) {
        markThreadDraftSaved(previousThreadId);
        invalidateSoupEntity(previousThreadId);
        void refetchSoupEntity(previousThreadId, 'emailThread').catch(
          reportError
        );
      }
      void queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
      if (!completingThread) {
        void refetchSoupEntity(outcome.threadId, 'emailThread').catch(
          reportError
        );
      }
      void queryClient.invalidateQueries({
        queryKey: emailKeys.threadMessages(outcome.threadId).queryKey,
      });
    } catch (error) {
      reportError(error);
    }
    return {
      draftId: outcome.draftId,
      threadId: outcome.threadId,
      inboxId: senderLinkId,
      persistence: 'committed',
    };
  }

  async function deleteDraftQueued(
    draftId: string,
    threadId: string,
    completingThread: boolean | undefined
  ): Promise<void> {
    const outcome = await executeGraphqlDeleteEmailDraft(
      getGraphqlSoupClient(),
      { draftId, threadDbId: threadId }
    );
    if (outcome.kind === 'failed') {
      throw persistRejection(outcome.code, 'Failed to delete draft', threadId);
    }
    // Queued: refetches wait for the commit's persisted revalidation.
    if (outcome.kind === 'queued') return;
    // Matches useDeleteDraftMutation's onSuccess effects.
    try {
      markThreadDraftSaved(threadId);
      void queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
      if (!completingThread) {
        void refetchSoupEntity(threadId, 'emailThread').catch(reportError);
        invalidateAllSoup();
      }
    } catch (error) {
      reportError(error);
    }
  }
  return {
    recipientName: (id) => getDisplayName(tryMacroId(id)),
    recordMention: (sourceId, targetId) => {
      void trackMention(sourceId, 'document', targetId).catch(reportError);
    },
    accounts: {
      ...inboxSource,
      primaryId,
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
      async blockingNotice({ title, body }) {
        await confirmDialog(
          { title, body, confirmLabel: 'OK' },
          { owner: dialogOwner }
        );
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
        const handles = queueHandles({ inboxId, ...input });
        if (handles?.threadId) {
          return await saveDraftQueued(
            input.draft,
            { ...handles, threadId: handles.threadId },
            inboxId,
            completingThread,
            previousThreadId
          );
        }
        const { clientHandles: _clientHandles, ...restInput } = input;
        const result = await save.mutateAsync({
          ...restInput,
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
        if (input.threadId && queueTransportActive()) {
          await deleteDraftQueued(
            input.draftId,
            input.threadId,
            completingThread
          );
          return;
        }
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
