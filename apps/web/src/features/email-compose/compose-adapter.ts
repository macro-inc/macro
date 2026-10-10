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
import { useEmail, useUserContext, useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { trackMention } from '@core/signal/mention';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import { getDisplayName, tryMacroId } from '@core/user';
import { deviceLooksOffline } from '@core/util/connectivity';
import { interceptMailtoLinks } from '@core/util/interceptMailtoLinks';
import { handleFileFolderDrop } from '@core/util/upload';
import { Telemetry } from '@macro-inc/observability';
import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import ArrowSquareOut from '@phosphor-icons/core/regular/arrow-square-out.svg?component-solid';
import ExclamationIcon from '@phosphor-icons/core/regular/exclamation-mark.svg?component-solid';
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
import { subscribeToDraftLifecycleChanges } from '@queries/email/draft-lifecycle-events';
import {
  assertEmailDraftQueueAvailable,
  deleteEmailDraftQueued,
  draftQueueActive,
  readEmailDraft,
  saveEmailDraftQueued,
  watchEmailDrafts,
} from '@queries/email/draft-queue';
import {
  archiveEmailThread,
  scheduleEmailMessage,
} from '@queries/email/integration';
import { emailKeys } from '@queries/email/keys';
import {
  findPrimaryEmailLinkId,
  nonPrimaryEmailLinkIdHeader,
} from '@queries/email/link';
import {
  clearLocalAttachmentReceipt,
  forgetLocalDraft,
  readLocalDraft,
  recordLocalAttachment,
  resumeLocalDraft,
  reviveLocalDraft,
  saveLocalDraft,
  withLocalAttachmentUpload,
} from '@queries/email/local-drafts';
import { useMailAccountsQuery } from '@queries/email/mail-accounts';
import { useQueuedEmailSends } from '@queries/email/queued-sends';
import {
  emailSendLocked,
  emailSendMatchesDraft,
  emailSendQueueSelected,
  sendEmailQueued,
} from '@queries/email/send-queue';
import {
  fetchAndCacheThread,
  type ThreadQueryTransport,
  useSendMessageMutation,
  useUnscheduleMessageMutation,
} from '@queries/email/thread';
import { invalidateSoupEntity, refetchSoupEntity } from '@queries/soup/cache';
import type { ApiThread } from '@service-email/generated/schemas';
import { getGraphqlCacheHost } from '@service-storage/graphql-soup';
import type { InfiniteData } from '@tanstack/solid-query';
import { confirmDialog } from '@ui';
import { type Accessor, getOwner } from 'solid-js';
import {
  type ComposeNoticeOptions,
  type DraftClientHandles,
  DraftPersistRejected,
  type DraftSaveResult,
  type EmailComposeContext,
  type SaveEmailDraft,
} from './context/compose-capabilities';
import { localDraftReadyForDelivery } from './core/local-draft';
import { readDroppedEmailFiles, withVideoAttachments } from './editor-adapter';
import { makeAttachmentPublic } from './make-attachment-public';
import {
  emailDraftLifecycleSource,
  publishDraftLifecycleChange,
} from './queries/draft-lifecycle';
import { createEmailInboxSource } from './queries/inbox-source';
import { queuedDraftSaveArgs } from './queries/queued-draft';
import {
  restoreDraftBodyAfterUndo,
  runQueuedUndoSend,
  runUndoSend,
} from './undo-send';

export type EmailComposeContextOptions = {
  /** Transport of the thread read this surface sits under; a compose surface has none. */
  threadTransport?: Accessor<ThreadQueryTransport | undefined>;
};

/** Construct under the composing surface's Solid owner to scope request progress. */
export function createEmailComposeContext(
  options: EmailComposeContextOptions = {}
): EmailComposeContext {
  const accounts = useMailAccountsQuery();
  const graphqlSoupFlag = useFeatureFlag(enableGraphqlSoup);
  const queueActive = () =>
    draftQueueActive(
      options.threadTransport?.() ??
        (graphqlSoupFlag().enabled ? 'graphql' : 'rest')
    );
  // Transport degradation cannot release authority held by a durable send.
  const durableSendSelected = () =>
    emailSendQueueSelected(
      options.threadTransport?.() ??
        (graphqlSoupFlag().enabled ? 'graphql' : 'rest')
    );
  let durableSendWasSelected = durableSendSelected();
  const observeSends = () => {
    durableSendWasSelected ||= durableSendSelected();
    return durableSendWasSelected;
  };
  const sends = useQueuedEmailSends(observeSends);
  // Attach handlers run as event handlers, which have no Solid owner of
  // their own; the dialog needs the surface's.
  const dialogOwner = getOwner();
  const user = useUserContext();
  const paywall = usePaywallState();
  const viewerEmail = useEmail();
  const viewerId = useUserId();
  const primaryId = () =>
    accounts.isSuccess
      ? findPrimaryEmailLinkId(accounts.data?.links ?? [], viewerId())
      : undefined;
  const headerId = (id: string | null | undefined) =>
    nonPrimaryEmailLinkIdHeader(id, primaryId());
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
    actions: options?.actions?.map(({ kind, ...action }) => ({
      ...action,
      icon: kind === 'open' ? ArrowSquareOut : ArrowCounterClockwise,
    })),
  });
  const reportError = (error: unknown) =>
    Telemetry.error(error instanceof Error ? error : new Error(String(error)));
  const requireSavedDraftForDelivery = async (
    draftId: string | null | undefined
  ) => {
    if (!queueActive() || !draftId) return;
    const local = await readLocalDraft(draftId);
    if (local && !localDraftReadyForDelivery(local))
      throw new Error(
        'Save the latest draft and attachments before sending or scheduling'
      );
  };
  // A thread view renders its latest draft as the composer until the thread
  // is read again, so every delivery change refetches it.
  const refreshThread = (threadId: string | undefined) => {
    if (!threadId) return;
    if (isFeatureEnabled(enableGraphqlSoup)) {
      void (async () => {
        const result = await fetchAndCacheThread(threadId);
        if (result.isErr())
          reportError(
            new Error(
              `Failed to refresh email thread ${threadId}: ${result.error
                .map((error) => `${error.code}: ${error.message}`)
                .join(', ')}`
            )
          );
      })().catch(reportError);
      return;
    }
    void queryClient
      .invalidateQueries({
        queryKey: emailKeys.threadMessages(threadId).queryKey,
      })
      .catch(reportError);
  };

  // Queued writes address a draft by handles: the composer's minted ones, or a
  // confirmed draft's server ids, which resolve as their own handles.
  const queueHandles = ({
    draft,
    clientHandles,
  }: SaveEmailDraft):
    | (DraftClientHandles & { threadId: string })
    | undefined => {
    if (!queueActive()) return undefined;
    if (clientHandles?.threadId) {
      return { ...clientHandles, threadId: clientHandles.threadId };
    }
    return draft.db_id && draft.thread_db_id
      ? { draftId: draft.db_id, threadId: draft.thread_db_id }
      : undefined;
  };

  return {
    draftLifecycle: emailDraftLifecycleSource,
    recipientName: (id) => getDisplayName(tryMacroId(id)),
    recordMention: (sourceId, targetId) => {
      void trackMention(sourceId, 'document', targetId).catch(reportError);
    },
    accounts: {
      ...inboxSource,
      primaryId,
    },
    connectivity: { looksOffline: deviceLooksOffline },
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
          withVideoAttachments(
            createFilesReadyHandler(
              input.editor,
              input.sourceId,
              input.sourceId ? 'email' : undefined,
              input.dropEvent && input.editor
                ? () =>
                    getDragDropPosition(input.editor!, input.dropEvent!, true)
                : undefined,
              input.onUploaded,
              { width: 542, height: 542 }
            ),
            input.onVideos
          )
        );
      },
    },
    notices: {
      feedback: {
        success: (message, options) => toast.success(message, notice(options)),
        failure: (message, options) => {
          if (options?.persistent)
            return toast.custom(
              {
                title: message,
                content: () => options.subtext,
                icon: ExclamationIcon,
                color: 'var(--color-failure)',
                actions: notice(options).actions,
              },
              { persistent: true }
            );
          toast.failure(message, notice(options));
          return undefined;
        },
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
      watchRestorations: (changed) =>
        subscribeToDraftLifecycleChanges((event) => {
          if (event.restoration)
            changed({
              ...event.restoration,
              draftId: event.draftId,
              inboxId: event.inboxId,
            });
        }),
      get saveLocalDraft() {
        return queueActive()
          ? (input: import('@queries/email/local-drafts').LocalDraftInput) =>
              saveLocalDraft({
                ...input,
                inboxId: input.inboxId ?? primaryId(),
                senderEmail:
                  inboxSource
                    .inboxes()
                    .find(
                      (inbox) => inbox.id === (input.inboxId ?? primaryId())
                    )?.email_address ?? viewerEmail(),
              })
          : undefined;
      },
      get retryDraft() {
        return queueActive() ? resumeLocalDraft : undefined;
      },
      get readDraft() {
        return queueActive() ? readEmailDraft : undefined;
      },
      get watchDrafts() {
        return queueActive() ? watchEmailDrafts : undefined;
      },
      async saveDraft({
        completingThread,
        previousThreadId,
        inboxId,
        ...input
      }) {
        assertEmailDraftQueueAvailable();
        const handles = queueHandles(input);
        if (handles) {
          if (!(await readLocalDraft(handles.draftId)))
            await saveLocalDraft({
              ...input,
              clientHandles: handles,
              inboxId: inboxId ?? primaryId(),
              attachments: [],
            });
          const local = await readLocalDraft(handles.draftId);
          const senderLinkId = local?.inboxId ?? inboxId ?? primaryId() ?? '';
          const outcome = await saveEmailDraftQueued({
            args: {
              ...queuedDraftSaveArgs({
                draft: local?.content ?? input.draft,
                handles: local
                  ? {
                      draftId: local.draftId,
                      threadId: local.threadId ?? handles.threadId,
                    }
                  : handles,
                senderLinkId,
                senderAccount: accounts.isSuccess
                  ? accounts.data?.links.find(
                      (link) => link.id === senderLinkId
                    )
                  : undefined,
                senderEmail:
                  inboxSource
                    .inboxes()
                    .find((inbox) => inbox.id === senderLinkId)
                    ?.email_address ??
                  viewerEmail() ??
                  '',
              }),
              localRevision: local?.revision,
            },
            completingThread,
            previousThreadId,
          });
          if (outcome.kind === 'rejected') {
            throw new DraftPersistRejected(outcome.code);
          }
          const saved: DraftSaveResult =
            outcome.kind === 'queued'
              ? { ...handles, inboxId: senderLinkId, persistence: 'queued' }
              : {
                  draftId: outcome.draftId,
                  threadId: outcome.threadId,
                  inboxId: senderLinkId,
                  persistence: 'committed',
                };
          return saved;
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
        assertEmailDraftQueueAvailable();
        if (input.threadId && queueActive()) {
          const outcome = await deleteEmailDraftQueued({
            draftId: input.draftId,
            threadId: input.threadId,
            completingThread,
          });
          if (outcome.kind === 'rejected') {
            throw new DraftPersistRejected(outcome.code);
          }
          return;
        }
        await remove.mutateAsync({
          ...input,
          linkId: headerId(inboxId),
          skipSoupRefetch: completingThread,
        });
        try {
          publishDraftLifecycleChange(input.draftId, inboxId);
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
        if (queueActive()) await reviveLocalDraft(draftId);
        if (threadId && isFeatureEnabled(enableGraphqlSoup))
          void fetchAndCacheThread(threadId);
      },
    },
    delivery: {
      queueActive: durableSendSelected,
      sendLocked: (draftId) =>
        (observeSends() &&
          (!sends.ready() ||
            !getGraphqlCacheHost() ||
            getGraphqlCacheHost()?.disabled === true)) ||
        (!!draftId &&
          sends
            .intents()
            .some(
              (intent) =>
                emailSendMatchesDraft(intent, draftId) &&
                emailSendLocked(intent)
            )),
      async sendMessage({ completingThread, inboxId, ...input }) {
        if (durableSendSelected()) {
          const senderLinkId = inboxId ?? primaryId() ?? '';
          const draftId = input.clientHandles?.draftId ?? input.message.db_id;
          const threadId =
            input.clientHandles?.threadId ?? input.message.thread_db_id;
          if (!draftId || !threadId)
            throw new Error('Draft identity is required to queue a send');
          return await sendEmailQueued({
            expectedLocalVersion: input.expectedLocalVersion,
            draft: queuedDraftSaveArgs({
              draft: input.message,
              handles: { draftId, threadId },
              senderLinkId,
              senderAccount: accounts.isSuccess
                ? accounts.data?.links.find((link) => link.id === senderLinkId)
                : undefined,
              senderEmail:
                inboxSource.inboxes().find((inbox) => inbox.id === senderLinkId)
                  ?.email_address ?? '',
            }),
            attachmentIds: input.attachmentIds ?? [],
            forwardedAttachmentIds: input.forwardedAttachmentIds ?? [],
            includeSignature: input.message.include_signature,
            restoreBodyHtml: input.restoreBodyHtml,
            restoreBodyText: input.restoreBodyText,
            restoreBodyMacro: input.restoreBodyMacro,
          });
        }
        await requireSavedDraftForDelivery(input.message.db_id);
        const result = await send.mutateAsync({
          message: input.message,
          linkId: headerId(inboxId),
          skipSoupRefetch: completingThread,
        });
        try {
          if (queueActive() && input.message.db_id)
            await forgetLocalDraft(input.message.db_id);
          if (result.message.db_id)
            publishDraftLifecycleChange(
              result.message.db_id,
              result.message.link_id
            );
          if (result.message.thread_db_id) {
            markThreadDraftSaved(result.message.thread_db_id);
            refreshThread(result.message.thread_db_id);
          }
        } catch (error) {
          reportError(error);
        }
        return {
          draftId: result.message.db_id ?? undefined,
          threadId: result.message.thread_db_id ?? undefined,
          inboxId: result.message.link_id,
        };
      },
      async unschedule({ draftId, threadId, inboxId }) {
        await unschedule.mutateAsync({
          draftID: draftId,
          linkId: headerId(inboxId),
        });
        try {
          publishDraftLifecycleChange(draftId, inboxId);
          invalidateSoupEntity(draftId);
          refreshThread(threadId);
        } catch (error) {
          reportError(error);
        }
      },
      schedule: async (
        { draftId, threadId, sendTime, includeSignature },
        inboxId
      ) => {
        await requireSavedDraftForDelivery(draftId);
        await scheduleEmailMessage(
          {
            draftID: draftId,
            send_time: sendTime,
            include_signature: includeSignature,
          },
          headerId(inboxId)
        );
        try {
          publishDraftLifecycleChange(draftId, inboxId);
          refreshThread(threadId);
          void queryClient
            .invalidateQueries({
              queryKey: emailKeys.scheduledMessages._def,
            })
            .catch(reportError);
        } catch (error) {
          // Cache and cross-tab notifications are post-commit UI work. A
          // failure here must not make a successful schedule retryable.
          reportError(error);
        }
      },
      archive: async ({ threadId, value }, inboxId) => {
        await archiveEmailThread({ id: threadId, value }, headerId(inboxId));
      },
      undoSend: async (input) => {
        if (input.sendAttemptId) {
          await runQueuedUndoSend({
            draftId: input.draftId,
            attemptId: input.sendAttemptId,
            onUndone: () => input.onUndone({ draftRestored: true }),
          });
          return;
        }
        await runUndoSend({
          draftId: input.draftId,
          linkId: headerId(input.inboxId),
          onUndone: async () => {
            await input.onUndone();
            if (input.threadId)
              void refetchSoupEntity(input.threadId, 'emailThread');
          },
        });
      },
    },
    attachmentStorage: {
      async uploadAttachments({ draftId, inboxId, ...input }) {
        for (const file of input.attachments) {
          const run = async (
            receipt?: { attachmentId?: string; uploaded: boolean },
            generation?: string
          ) => {
            if (receipt?.uploaded && receipt.attachmentId) {
              input.onAttachmentUploaded?.(file, receipt.attachmentId);
              return;
            }
            if (receipt?.attachmentId) {
              await removeAttachment.mutateAsync({
                draftID: draftId,
                attachmentID: receipt.attachmentId,
                linkId: headerId(inboxId),
              });
              await recordLocalAttachment(
                draftId,
                file,
                undefined,
                false,
                generation
              );
            }
            await upload.mutateAsync({
              draftID: draftId,
              attachments: [file],
              linkId: headerId(inboxId),
              onAttachmentAdded: async (uploadedFile, id) => {
                input.onAttachmentAdded?.(uploadedFile, id);
                if (queueActive())
                  await recordLocalAttachment(
                    draftId,
                    uploadedFile,
                    id,
                    false,
                    generation
                  );
              },
              onAttachmentUploaded: async (uploadedFile, id) => {
                input.onAttachmentUploaded?.(uploadedFile, id);
                if (queueActive())
                  await recordLocalAttachment(
                    draftId,
                    uploadedFile,
                    id,
                    true,
                    generation
                  );
              },
              onAttachmentUploadFailed: (uploadedFile) => {
                if (queueActive())
                  void recordLocalAttachment(
                    draftId,
                    uploadedFile,
                    undefined,
                    false,
                    generation
                  ).catch(reportError);
                input.onAttachmentUploadFailed?.(uploadedFile);
              },
            });
          };
          if (queueActive())
            await withLocalAttachmentUpload(draftId, file, run);
          else await run();
        }
      },
      addForwardedAttachments: ({ draftId, attachments, inboxId }) =>
        forward.mutateAsync({
          draftID: draftId,
          attachments: attachments.map(({ attachmentId }) => ({
            attachmentID: attachmentId,
          })),
          linkId: headerId(inboxId),
        }),
      removeAttachment: async ({ draftId, attachmentId, inboxId }) => {
        await removeAttachment.mutateAsync({
          draftID: draftId,
          attachmentID: attachmentId,
          linkId: headerId(inboxId),
        });
        if (queueActive()) {
          try {
            await clearLocalAttachmentReceipt(draftId, attachmentId);
          } catch (error) {
            reportError(error);
          }
        }
      },
      removeForwardedAttachment: ({ draftId, attachmentId, inboxId }) =>
        removeForwarded.mutateAsync({
          draftID: draftId,
          attachmentID: attachmentId,
          linkId: headerId(inboxId),
        }),
    },
  };
}
