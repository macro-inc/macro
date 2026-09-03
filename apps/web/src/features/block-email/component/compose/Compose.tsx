import { useFeatureFlag } from '@app/lib/analytics/posthog';
import type { EmailFormRecipients } from '@block-email/component/createEmailFormState';
import {
  createEmailFormState,
  type DraftFormAttachment,
} from '@block-email/component/createEmailFormState';
import {
  markThreadDraftSaved,
  useMaybeEmailContext,
} from '@block-email/component/EmailContext';
import { MACRO_EMAIL_SIGNATURE } from '@block-email/constants';
import { decodeBase64Utf8 } from '@block-email/util/decodeBase64';
import { ensureOnlineToAttach } from '@block-email/util/offlineAttachmentWarning';
import { plainTextToHtml } from '@block-email/util/plainTextToHtml';
import {
  clearEmailBody,
  hasDraftContent,
  prepareEmailBody,
} from '@block-email/util/prepareEmailBody';
import { convertEmailRecipientToContactInfo } from '@block-email/util/recipientConversion';
import {
  endUndoSend,
  restoreDraftBodyAfterUndo,
  runUndoSend,
} from '@block-email/util/undoSend';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { useSplitBackInterceptor } from '@components/app/split-layout/back-interceptor';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@components/app/split-layout/components/SplitLabel';
import { SplitPanelContext } from '@components/app/split-layout/context';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useHasPaidAccess } from '@core/auth';
import { EmailPermissionsBanner } from '@core/component/EmailPermissionsBanner';
import { toast } from '@core/component/Toast/Toast';
import {
  ENABLE_EMAIL_SIGNATURES_FLAG,
  ENABLE_EMAIL_SIGNATURES_OVERRIDE,
  ENABLE_GRAPHQL_SOUP,
} from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import { WrapUnlessMobile } from '@core/mobile/WrapUnlessMobile';
import { useCombinedRecipients } from '@core/signal/useCombinedRecipient';
import {
  type ContactInfo,
  emailToId,
  getDisplayName,
  recipientEntityMapper,
  tryMacroId,
  type WithCustomUserInput,
} from '@core/user';
import { deviceLooksOffline } from '@core/util/connectivity';
import { $generateHtmlFromNodes } from '@lexical/html';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@macro-inc/lexical-core';
import { Telemetry } from '@macro-inc/observability';

import ArrowCounterClockwise from '@phosphor-icons/core/regular/arrow-counter-clockwise.svg?component-solid';
import { queryClient } from '@queries/client';
import {
  useRemoveDraftAttachmentMutation,
  useRemoveForwardedAttachmentMutation,
  useUploadDraftAttachmentsMutation,
} from '@queries/email/attachment';
import {
  useDeleteDraftMutation,
  useSaveDraftMutation,
} from '@queries/email/draft';
import { emailKeys } from '@queries/email/keys';
import {
  useEmailLinksQuery,
  useEmailSignature,
  useNonPrimaryEmailLinkIdHeader,
  usePrimaryEmailLinkId,
} from '@queries/email/link';
import {
  fetchAndCacheThread,
  useSendMessageMutation,
  useUnscheduleMessageMutation,
} from '@queries/email/thread';
import {
  invalidateAllSoup,
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/cache';
import { emailClient } from '@service-email/client';
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
import { debounce } from '@solid-primitives/scheduled';
import { Surface } from '@ui';
import * as EmailValidator from 'email-validator';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  getOwner,
  on,
  Show,
  useContext,
} from 'solid-js';
import { unwrap } from 'solid-js/store';
import { v7 as uuidv7 } from 'uuid';
import {
  type ComposeContextValue,
  ComposeProvider,
  type ComposeValidationError,
} from './ComposeContext';
import { ComposeLayout } from './ComposeLayout';
import { EmailComposeToolbar } from './ComposeToolbar';
import { SignaturePreview } from './SignaturePreview';

const DRAFT_DEBOUNCE_MS = 500;

type UndoComposeSnapshot = {
  draftId: string;
  recipients: EmailFormRecipients;
  subject: string;
  bodyHtml: string;
  attachments: DraftFormAttachment[];
  includeSignature: boolean;
};

let undoComposeSnapshot: UndoComposeSnapshot | null = null;

type EmailComposeProps = {
  draftID?: string;
  /** Prefill for the To field (e.g. from an intercepted mailto: link). Ignored when editing an existing draft. */
  initialTo?: string[];
};

export function EmailCompose(props: EmailComposeProps) {
  const hasPaidAccess = useHasPaidAccess();
  const emailLinksQuery = useEmailLinksQuery();
  const uploadAttachmentMutation = useUploadDraftAttachmentsMutation();
  const saveDraftMutation = useSaveDraftMutation();
  const deleteDraftMutation = useDeleteDraftMutation();
  const emailContext = useMaybeEmailContext();

  const form = createEmailFormState(
    props.draftID
      ? {
          type: 'draft',
          messageID: props.draftID,
        }
      : undefined,
    emailContext
      ? {
          getMessageByID: (id) =>
            emailContext.messages.unfiltered().find((m) => m.db_id === id),
          getDraftForMessageReply: emailContext.drafts.getDraftForMessage,
          onRecipientsChange: emailContext.onRecipientsChange,
        }
      : undefined
  );

  const primaryLinkId = usePrimaryEmailLinkId();
  const link = createMemo(() => {
    const data = emailLinksQuery.data;
    if (!data || data.links.length === 0) return undefined;
    // Send from the inbox the user picked, else the inbox that owns the draft
    // being edited, else the primary inbox — not whichever inbox sorts first.
    const draftLinkId = props.draftID
      ? emailContext?.messages
          .unfiltered()
          .find((m) => m.db_id === props.draftID)?.link_id
      : undefined;
    const targetId = form.selectedLinkId() ?? draftLinkId ?? primaryLinkId();
    return data.links.find((l) => l.id === targetId) ?? data.links[0];
  });

  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();
  // Scope writes to the inbox this compose sends from (its X-Email-Link-Id
  // header), so a non-primary "from" inbox drafts/sends from the right account.
  const headerLinkId = () => toHeaderLinkId(link()?.id);

  // The sending inbox's saved signature (empty for inboxes without one). New
  // emails include it by default; the preview's dismiss drops it for this one
  // message. The backend injects it on send (see include_signature below); the
  // FE only renders the preview and signals an explicit dismiss.
  const signature = useEmailSignature(() => link()?.id);
  const emailSignaturesFlag = useFeatureFlag(ENABLE_EMAIL_SIGNATURES_FLAG, {
    enabledOverride: ENABLE_EMAIL_SIGNATURES_OVERRIDE,
  });
  const [includeSignature, setIncludeSignature] = createSignal(true);

  const hasLinkError = createMemo(() => {
    if (emailLinksQuery.isPending) return false;
    return (
      emailLinksQuery.isError ||
      (emailLinksQuery.data && emailLinksQuery.data.links.length === 0)
    );
  });

  const { users: destinationOptions } = useCombinedRecipients();

  const [editor, setEditor] = createSignal<LexicalEditor | undefined>();
  const [content, setContent] = createSignal('');
  const [currentDraftID, setCurrentDraftID] = createSignal<string | undefined>(
    props.draftID
  );

  // Thread the draft currently lives under; switching the sending inbox
  // re-homes the draft server-side, so the previous thread's soup row must
  // be dropped after the save.
  const [currentThreadID, setCurrentThreadID] = createSignal<
    string | undefined
  >(
    props.draftID
      ? emailContext?.messages
          .unfiltered()
          .find((m) => m.db_id === props.draftID)?.thread_db_id
      : undefined
  );

  // Restore form state from undo-send snapshot if available
  const restoredSnapshot =
    undoComposeSnapshot?.draftId === props.draftID ? undoComposeSnapshot : null;

  if (restoredSnapshot) {
    form.setRecipients('to', restoredSnapshot.recipients.to);
    form.setRecipients('cc', restoredSnapshot.recipients.cc);
    form.setRecipients('bcc', restoredSnapshot.recipients.bcc);
    form.setSubject(restoredSnapshot.subject);
    for (const attachment of restoredSnapshot.attachments) {
      form.attachments.add(attachment);
    }
    setIncludeSignature(restoredSnapshot.includeSignature);
    undoComposeSnapshot = null;
  }

  if (!props.draftID && props.initialTo?.length) {
    form.setRecipients(
      'to',
      props.initialTo.map((email) =>
        recipientEntityMapper('custom')({
          id: emailToId(email),
          email,
          invalid: !EmailValidator.validate(email),
        })
      )
    );
  }

  // --- Draft persistence ---

  function collectDraft() {
    $removeAllWatermarkNodes(editor());
    const prepared = prepareEmailBody(editor());
    if (!prepared) {
      Telemetry.error(
        new Error('Unable to prepare email body for draft collection.')
      );
      return null;
    }
    if (
      !hasDraftContent(
        prepared.bodyText,
        form.subject(),
        form.attachments.list().length,
        form.recipients().to.length +
          form.recipients().cc.length +
          form.recipients().bcc.length
      )
    ) {
      return null;
    }
    return {
      bcc: form.recipients().bcc.map(convertEmailRecipientToContactInfo),
      body_html: prepared.bodyHtml,
      cc: form.recipients().cc.map(convertEmailRecipientToContactInfo),
      subject: form.subject(),
      to: form.recipients().to.map(convertEmailRecipientToContactInfo),
    };
  }

  // Per-session latch: content stays in the editor, but a save the server
  // rejected must never redispatch on its own — repeating a known-doomed
  // save just churns the queue and spams failures.
  let autosaveDisabled = false;

  // Content uploads still in flight, including ones started by earlier saves.
  // attachmentID only proves the draft record exists, and the send path treats
  // a resolved save as "attachments ready", so a save must not resolve while
  // any of these are pending.
  const inFlightAttachmentUploads = new Set<Promise<void>>();

  async function executeSaveDraft() {
    if (sendMutation.isPending || autosaveDisabled) {
      return;
    }
    const draftToSave = collectDraft();
    if (!draftToSave) {
      const draftID = currentDraftID();
      if (draftID) {
        const threadDbId = currentThreadID();
        if (graphqlCacheEnabled() && ENABLE_GRAPHQL_SOUP() && threadDbId) {
          const deleted = await executeQueuedGraphqlDelete(draftID, threadDbId);
          if (!deleted) return;
        } else {
          await deleteDraftMutation.mutateAsync({
            draftId: draftID,
            threadId: currentThreadID(),
            linkId: headerLinkId(),
          });
        }
      }
      setCurrentDraftID(undefined);
      return;
    }

    // Compose drafts go through the durable GraphQL queue too: draft AND
    // thread identity are client-minted handles, so offline saves replay as
    // idempotent upserts against server-minted rows. The uncached fallback
    // client has no queue, so REST remains the fallback — but REST resolves
    // only server-minted ids: ids adopted from committed saves carry over,
    // while a handle from a queued-only session fails on REST until its
    // queued save commits.
    //
    // The flag gate keeps the mutation on the same transport as the email
    // reads: queueing GraphQL saves while the rest of email reads REST
    // leaves the optimistic entity invisible (no cached pages to patch).
    if (graphqlCacheEnabled() && ENABLE_GRAPHQL_SOUP()) {
      return await executeQueuedGraphqlSave(draftToSave);
    }

    const previousThreadID = currentThreadID();
    const draftResponse = await saveDraftMutation.mutateAsync({
      draft: {
        ...draftToSave,
        db_id: currentDraftID(),
      },
      linkId: headerLinkId(),
    });

    const newThreadID = draftResponse.draft.thread_db_id ?? undefined;
    if (previousThreadID && previousThreadID !== newThreadID) {
      invalidateSoupEntity(previousThreadID);
      refetchSoupEntity(previousThreadID, 'emailThread');
    }
    setCurrentThreadID(newThreadID);

    const draftId = draftResponse.draft.db_id;
    if (draftId) {
      await uploadComposeAttachments(draftId);
      setCurrentDraftID(draftId);
      return draftId;
    }
  }

  async function executeQueuedGraphqlSave(
    draftToSave: NonNullable<ReturnType<typeof collectDraft>>
  ) {
    // Identity is local-first: both handles are minted before the first
    // dispatch, so every queued save for this compose session resolves to
    // one server draft in one thread — even when the responses arrive after
    // an app restart with no caller alive. The server maps handles to
    // server-minted rows; committed ids are adopted below for later calls.
    // Minted v7 (best effort, never trusted) to keep the mapping index
    // friendly.
    const draftId = currentDraftID() ?? uuidv7();
    setCurrentDraftID(draftId);
    const previousThreadID = currentThreadID();
    const threadDbId = previousThreadID ?? uuidv7();
    setCurrentThreadID(threadDbId);

    const outcome = await executeGraphqlSaveEmailDraft(getGraphqlSoupClient(), {
      draftId,
      threadDbId,
      linkId: headerLinkId(),
      subject: draftToSave.subject,
      to: draftToSave.to.map(draftContactInput),
      cc: draftToSave.cc.map(draftContactInput),
      bcc: draftToSave.bcc.map(draftContactInput),
      bodyHtml: draftToSave.body_html,
      senderLinkId: link()?.id ?? '',
      senderEmail: String(link()?.email_address ?? ''),
      optimisticBodyHtml: draftToSave.body_html
        ? decodeBase64Utf8(draftToSave.body_html)
        : null,
    });

    if (outcome.kind === 'queued') {
      // Durably accepted locally; attachments and soup bookkeeping wait for
      // a committed save — offline neither could succeed anyway.
      return draftId;
    }
    if (outcome.kind === 'failed') {
      handleQueuedSaveFailure(outcome.code);
      return;
    }

    // The server may re-home the draft (sender switch) or converge onto
    // different IDs — adopt its answers.
    if (outcome.draftId !== draftId) setCurrentDraftID(outcome.draftId);
    if (previousThreadID && previousThreadID !== outcome.threadId) {
      invalidateSoupEntity(previousThreadID);
      refetchSoupEntity(previousThreadID, 'emailThread');
    }
    setCurrentThreadID(outcome.threadId);
    await uploadComposeAttachments(outcome.draftId);
    // Keep the REST-facade caches honest during the transport rollout,
    // matching useSaveDraftMutation's onSuccess effects.
    queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
    refetchSoupEntity(outcome.threadId, 'emailThread');
    queryClient.invalidateQueries({
      queryKey: emailKeys.threadMessages(outcome.threadId).queryKey,
    });
    return outcome.draftId;
  }

  // Sent from another device: the server outcome supersedes the local
  // draft. Drop it — thread handle included, so the next compose session
  // can't attach a new draft to the sent thread — and refresh the caches
  // that still show it as a draft.
  function handleDraftAlreadySent() {
    toast.alert('This email was already sent');
    const threadID = currentThreadID();
    resetState();
    setCurrentThreadID(undefined);
    queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
    if (threadID) {
      invalidateSoupEntity(threadID);
      refetchSoupEntity(threadID, 'emailThread');
    }
  }

  function handleQueuedSaveFailure(code: SaveEmailDraftFailureCode) {
    if (code === 'DRAFT_ALREADY_SENT') {
      handleDraftAlreadySent();
      return;
    }
    if (code !== 'NETWORK') {
      // Deterministic failure: keep the content in the editor, but never
      // auto-re-dispatch — a failing save replayed forever would block every
      // queued mutation in the app behind it.
      autosaveDisabled = true;
    }
    console.error('Failed to save draft', code);
    toast.failure('Failed to save draft');
  }

  /**
   * Discard the compose draft through the durable queue. Returns whether
   * the caller may proceed with its local reset — a queued delete counts
   * as success (the optimistic removal already hides the draft, and the
   * replay is idempotent however late it lands).
   */
  async function executeQueuedGraphqlDelete(
    draftId: string,
    threadDbId: string
  ): Promise<boolean> {
    const outcome = await executeGraphqlDeleteEmailDraft(
      getGraphqlSoupClient(),
      { draftId, threadDbId }
    );
    if (outcome.kind === 'queued') return true;
    if (outcome.kind === 'failed') {
      if (outcome.code === 'DRAFT_ALREADY_SENT') {
        // No longer a draft to discard; the handler already reset.
        handleDraftAlreadySent();
        return false;
      }
      console.error('Failed to delete draft', outcome.code);
      toast.failure('Failed to delete draft');
      return false;
    }
    // Keep the REST-facade caches honest during the transport rollout,
    // matching useDeleteDraftMutation's onSuccess effects. Discarding a
    // compose draft usually deletes its thread too — the refetch then finds
    // nothing, and the soup invalidation drops it from the lists.
    queryClient.invalidateQueries({ queryKey: emailKeys.previews._def });
    refetchSoupEntity(threadDbId, 'emailThread');
    invalidateAllSoup();
    return true;
  }

  async function uploadComposeAttachments(draftId: string) {
    const attachments = form.attachments
      .list()
      .filter((a) => a.type === 'local' && !a.attachmentID) as Extract<
      DraftFormAttachment,
      { type: 'local' }
    >[];

    let uploadRun: Promise<void> | undefined;
    if (attachments.length) {
      uploadRun = uploadAttachmentMutation.mutateAsync({
        draftID: draftId,
        attachments: attachments.map((a) => a.file),
        linkId: headerLinkId(),
        onAttachmentAdded: form.attachments.assignAttachmentID,
        onAttachmentUploadFailed: form.attachments.clearAttachmentID,
      });
      const tracked = uploadRun.then(
        () => undefined,
        () => undefined
      );
      inFlightAttachmentUploads.add(tracked);
      tracked.then(() => inFlightAttachmentUploads.delete(tracked));
    }

    // The send path treats a resolved save as "attachments ready", so drain
    // every in-flight upload — including ones started by earlier saves.
    while (inFlightAttachmentUploads.size) {
      await Promise.all([...inFlightAttachmentUploads]);
    }
    // Settled by the drain above, this only rethrows this save's own failure
    if (uploadRun) await uploadRun;
  }

  // Edits since the composer opened; an untouched existing draft can be
  // left without the keep-or-delete prompt.
  const [draftDirty, setDraftDirty] = createSignal(false);

  const scheduleDraftSave = debounce(() => {
    void executeSaveDraft();
  }, DRAFT_DEBOUNCE_MS);

  const markDirtyAndScheduleSave = () => {
    setDraftDirty(true);
    scheduleDraftSave();
  };

  // --- Attachment handling ---

  const removeAttachmentMutation = useRemoveDraftAttachmentMutation();
  const removeForwardedAttachmentMutation =
    useRemoveForwardedAttachmentMutation();

  const attachDialogOwner = getOwner();
  const handleAddAttachments = async (attachments: DraftFormAttachment[]) => {
    if (!(await ensureOnlineToAttach(attachDialogOwner))) return;
    for (const attachment of attachments) {
      form.attachments.add(attachment);
    }
    markDirtyAndScheduleSave();
  };

  const handleRemoveAttachment = (attachment: DraftFormAttachment) => {
    setDraftDirty(true);
    if (attachment.type === 'local') {
      form.attachments.removeByFile(attachment.file);
    } else if (attachment.type === 'forwarded') {
      form.attachments.removeForwarded(attachment.attachmentID);
    } else {
      form.attachments.removeByID(attachment.attachmentID);
    }

    const savedDraftID = currentDraftID();
    if (!savedDraftID || !attachment.attachmentID) return;

    if (attachment.type === 'forwarded') {
      removeForwardedAttachmentMutation.mutate({
        draftID: savedDraftID,
        attachmentID: attachment.attachmentID,
        linkId: headerLinkId(),
      });
    } else {
      removeAttachmentMutation.mutate({
        draftID: savedDraftID,
        attachmentID: attachment.attachmentID,
        linkId: headerLinkId(),
      });
    }
  };

  // --- Content change ---

  let firstChangeConsumed = false;
  const onContentChange = (newContent: string) => {
    setContent(newContent);
    if (!firstChangeConsumed) {
      firstChangeConsumed = true;
      return;
    }
    markDirtyAndScheduleSave();
  };

  // --- Send ---

  const { replaceSplit } = useSplitLayout();

  const [validationError, setValidationError] =
    createSignal<ComposeValidationError | null>(null);

  // Everything that follows a successful unschedule: scrub the new thread's
  // cache, restore the server-side draft, and remount the compose view so it
  // restores the form from the undo snapshot.
  const restoreAfterUndoSend = async (
    draftId: string,
    threadId: string | undefined,
    linkId: string | undefined
  ) => {
    // Wipe the new thread's cache when its view unmounts (replaceSplit
    // below) so the next visit fetches fresh data without the sent message.
    if (threadId && !ENABLE_GRAPHQL_SOUP()) markThreadDraftSaved(threadId);

    // Overwrite the server-side draft with the pre-send content. The
    // snapshot itself stays for the compose remount below to restore the
    // form from.
    const snapshot =
      undoComposeSnapshot?.draftId === draftId ? undoComposeSnapshot : null;
    if (snapshot) {
      await restoreDraftBodyAfterUndo(
        {
          bcc: snapshot.recipients.bcc.map(convertEmailRecipientToContactInfo),
          cc: snapshot.recipients.cc.map(convertEmailRecipientToContactInfo),
          db_id: draftId,
          subject: snapshot.subject,
          to: snapshot.recipients.to.map(convertEmailRecipientToContactInfo),
        },
        snapshot.bodyHtml,
        linkId
      );
    }

    // GraphQL mode renders threads from the normalized cache, which
    // markThreadDraftSaved's TanStack cleanup can't reach — refetch through
    // it (after the draft-body restore) so a revisit doesn't replay the
    // undone message from cache.
    if (threadId && ENABLE_GRAPHQL_SOUP()) {
      void fetchAndCacheThread(threadId);
    }

    replaceSplit({
      content: {
        type: 'component',
        id: 'email-compose',
        params: { draftID: draftId },
        // reattach() strips params by default; keep draftID so the compose
        // remount can restore the undo snapshot.
        preserveParams: true,
      },
    });
  };

  // `linkId` is the X-Email-Link-Id header value the send itself used, resolved
  // at send time.
  const undoSend = (
    draftId: string,
    threadId: string | undefined,
    linkId: string | undefined
  ) =>
    runUndoSend({
      draftId,
      linkId,
      onUndone: () => restoreAfterUndoSend(draftId, threadId, linkId),
    });

  const sendMutation = useSendMessageMutation({
    onSuccess: (data, vars) => {
      const draftId = data.message.db_id;
      const threadId = data.message.thread_db_id;
      // This send opens a fresh undo cycle for the draft id.
      if (draftId) endUndoSend(draftId);
      const sendLinkId = vars.linkId;
      const toastId = toast.success('Email sent', {
        actions: draftId
          ? [
              {
                label: 'Undo',
                icon: ArrowCounterClockwise,
                onClick: () => {
                  if (toastId != null) toast.dismiss(toastId);
                  void undoSend(draftId, threadId ?? undefined, sendLinkId);
                },
              },
            ]
          : undefined,
        duration: 5_000,
      });
      if (data.message.thread_db_id) {
        replaceSplit({
          content: { type: 'email', id: data.message.thread_db_id },
          mergeHistory: true,
        });
      }
    },
    onError: () => {
      toast.failure('Failed to send email');
    },
  });

  const onSubmit = async () => {
    setValidationError(null);

    const currentEditor = editor();
    const currentLink = link();
    const recipients = form.recipients();

    if (!recipients.to.length) {
      setValidationError({
        type: 'no_recipient',
        message: 'Please select at least one recipient',
      });
      return;
    }

    if (!content().trim()) {
      setValidationError({
        type: 'no_message',
        message: 'Please enter a message',
      });
      return;
    }

    if (!form.subject()?.trim()) {
      setValidationError({
        type: 'no_subject',
        message: 'Please enter a subject',
      });
      return;
    }

    if (!currentLink) {
      setValidationError({
        type: 'no_link',
        message: 'Unable to find linked email account',
      });
      return;
    }

    // Failsafe: don't send if a scheduled send time is set
    if (form.sendTime()) {
      return;
    }

    // Ensure the draft is saved before sending so undo-send always has a
    // draft id to snapshot and restore (the send reuses the draft's db_id).
    scheduleDraftSave.clear();
    try {
      await executeSaveDraft();
    } catch {
      // Draft save is best-effort; the send still works without one.
    }

    // Snapshot editor state before watermark so undo-send can restore it
    if (currentEditor) {
      const snapshotHtml = currentEditor.read(() =>
        $generateHtmlFromNodes(currentEditor)
      );
      const draftId = currentDraftID();
      if (draftId) {
        undoComposeSnapshot = {
          draftId,
          recipients: structuredClone(unwrap(form.recipients())),
          subject: form.subject(),
          bodyHtml: snapshotHtml,
          attachments: [...form.attachments.list()],
          includeSignature: includeSignature(),
        };
      }
    }

    // Append watermark after all validation passes so failed sends don't
    // leave orphaned watermark nodes in the editor tree.
    const cleanupWatermark = $appendWatermarkNodeToLast(
      currentEditor,
      !hasPaidAccess() ? MACRO_EMAIL_SIGNATURE : undefined
    );

    const prepared = prepareEmailBody(currentEditor);
    if (!prepared) {
      cleanupWatermark();
      return;
    }

    const bodyMacro = content();

    sendMutation.mutate({
      message: {
        to: convertToContactInfoArray(recipients.to),
        cc:
          recipients.cc.length > 0
            ? convertToContactInfoArray(recipients.cc)
            : [],
        bcc:
          recipients.bcc.length > 0
            ? convertToContactInfoArray(recipients.bcc)
            : [],
        subject: form.subject(),
        body_text: prepared.bodyText,
        body_html: prepared.bodyHtml,
        body_macro: bodyMacro,
        db_id: currentDraftID(),
        // Backend includes the signature by default for new emails; only signal
        // an explicit dismiss. Omitting it falls through to the backend default.
        include_signature: includeSignature() ? undefined : false,
      },
      linkId: headerLinkId(),
    });

    cleanupWatermark();
  };

  // --- Schedule ---

  const unscheduleMessageMutation = useUnscheduleMessageMutation({
    onSuccess: (_data, vars) => {
      toast.success('Email unscheduled');
      invalidateSoupEntity(vars.draftID);
    },
    onError: () => {
      toast.failure('Failed to unschedule email');
    },
  });

  const handleSendTimeChange = async (date: Date | null) => {
    setDraftDirty(true);
    const currentSendTime = form.sendTime();
    const currentDraft = currentDraftID();

    if (!date && currentSendTime && currentDraft) {
      unscheduleMessageMutation.mutate({
        draftID: currentDraft,
        linkId: headerLinkId(),
      });
      form.setSendTime(date);
      return;
    }

    // Scheduling and archiving are REST calls that resolve server ids only,
    // and the schedule endpoint is never queued — so refuse offline outright
    // instead of leaving a scheduled-looking draft the server never saw.
    if (date && deviceLooksOffline()) {
      toast.failure('Failed to schedule message', {
        subtext: "You're offline",
      });
      return;
    }

    form.setSendTime(date);

    if (date) {
      // Always save fresh: a committed save adopts server-minted draft and
      // thread ids, replacing any local handle left by a queued offline
      // save — which the REST endpoints below cannot resolve.
      const draftID = await executeSaveDraft();
      if (!draftID) {
        form.setSendTime(null);
        toast.failure('Failed to schedule message', {
          subtext: 'Draft required',
        });
        return;
      }

      try {
        await emailClient.scheduleMessage(
          {
            draftID,
            send_time: date.toISOString(),
          },
          headerLinkId()
        );
      } catch {
        form.setSendTime(null);
        toast.failure('Failed to schedule message');
        return;
      }

      const threadID = currentThreadID();
      if (threadID) {
        // Best-effort bookkeeping: the message is scheduled either way.
        await emailClient
          .flagArchived({ id: threadID, value: true }, headerLinkId())
          .catch(() => {});
      }
    }
  };

  // Unschedule when all recipients are removed
  const totalRecipientCount = () => {
    const r = form.recipients();
    return r.to.length + r.cc.length + r.bcc.length;
  };
  createEffect(
    on(
      totalRecipientCount,
      (count) => {
        if (count === 0 && form.sendTime()) {
          handleSendTimeChange(null);
        }
      },
      { defer: true }
    )
  );

  // --- Reset / delete ---

  const resetState = () => {
    clearEmailBody(editor());
    setContent('');
    setCurrentDraftID(undefined);
    form.clear();
  };

  const deleteDraftAndReset = async () => {
    const draftId = currentDraftID();
    if (draftId) {
      const threadDbId = currentThreadID();
      if (graphqlCacheEnabled() && ENABLE_GRAPHQL_SOUP() && threadDbId) {
        const deleted = await executeQueuedGraphqlDelete(draftId, threadDbId);
        if (!deleted) return;
      } else {
        await deleteDraftMutation.mutateAsync({
          draftId,
          threadId: currentThreadID(),
          linkId: headerLinkId(),
        });
      }
    }
    resetState();
  };

  // --- Derived state ---

  const initialHtml = () => {
    if (restoredSnapshot) {
      return restoredSnapshot.bodyHtml;
    }

    const draft = form.draft;
    if (!draft) return;

    if (draft.body_html_sanitized) {
      return decodeBase64Utf8(draft.body_html_sanitized);
    }

    if (draft.body_text) {
      return plainTextToHtml(draft.body_text);
    }
  };

  const getRecipientOptions = () => {
    const fromDraft = emailContext?.recipientOptions();
    return fromDraft ?? destinationOptions();
  };

  const previewName = createMemo(() => {
    const recipients = form.recipients().to;
    if (recipients.length === 0) {
      return 'Draft email';
    }

    if (recipients.length === 1) {
      let recipientName = recipients[0].data.email;

      if (recipients[0].kind === 'user') {
        recipientName = getDisplayName(tryMacroId(recipients[0].data.id));
      }

      return recipientName ? `Email to ${recipientName}` : 'Draft email';
    }

    const names = recipients
      .slice(0, 2)
      .map((r) => {
        if (r.kind === 'user') {
          return getDisplayName(tryMacroId(r.data.id));
        }
        return r.data.email || 'Unknown';
      })
      .filter(Boolean);

    if (recipients.length > 2) {
      return `Email to ${names.join(', ')}, and others`;
    }

    return `Email to ${names.join(' and ')}`;
  });

  // --- Context value ---

  const ctxValue: ComposeContextValue = {
    // Form state (read)
    recipients: form.recipients,
    subject: form.subject,
    attachments: form.attachments.list,
    sendTime: form.sendTime,
    initialHtml,

    // Form state (write)
    setRecipients: (field, value) => {
      form.setRecipients(field, value);
      markDirtyAndScheduleSave();
    },
    setSubject: (value) => {
      form.setSubject(value);
      markDirtyAndScheduleSave();
    },
    onContentChange,
    onAddAttachments: handleAddAttachments,
    onRemoveAttachment: handleRemoveAttachment,

    // Editor
    captureEditor: setEditor,

    // Actions
    onSend: () => void onSubmit(),
    onDelete: () => void deleteDraftAndReset(),
    onSendTimeChange: handleSendTimeChange,

    // Status
    disabled: () => hasLinkError() || sendMutation.isPending,
    isSending: () => sendMutation.isPending,
    hasDraft: () => currentDraftID() != null,

    // Validation
    validationError: (type) => {
      const error = validationError();
      if (error?.type === type) return error;
      return undefined;
    },

    // Recipients
    recipientOptions: getRecipientOptions,
    focusRecipientsOnMount: !hasLinkError(),

    // Schedule send
    scheduleSendDisabled: () => totalRecipientCount() === 0,

    // Display
    fromAddress: () => link()?.email_address,
    fromInboxes: () => emailLinksQuery.data?.links ?? [],
    selectedFromLinkId: () => link()?.id,
    // Persist immediately on a sender switch so the draft moves to the new
    // inbox even without a text edit.
    onSelectFromLink: (linkId) => {
      form.setSelectedFromLink(linkId);
      setDraftDirty(true);
      scheduleDraftSave.clear();
      void executeSaveDraft();
    },
    hasPaidAccess,

    // Read-only preview of the signature appended on send, with a per-message
    // dismiss. Shown only when the sending inbox has a signature and it hasn't
    // been dismissed.
    signaturePreview: () => (
      <Show
        when={
          emailSignaturesFlag().enabled && includeSignature() && signature()
        }
      >
        {(html) => (
          <SignaturePreview
            html={html()}
            onDismiss={() => setIncludeSignature(false)}
          />
        )}
      </Show>
    ),
  };

  const panel = useContext(SplitPanelContext);
  const [draftBackMenuOpen, setDraftBackMenuOpen] = createSignal(false);

  if (isMobile()) {
    // Backing out of a compose that has a draft asks whether to keep it.
    useSplitBackInterceptor(() => {
      if (!ctxValue.hasDraft() || !draftDirty()) return false;
      setDraftBackMenuOpen(true);
      return true;
    });
  }

  const leaveCompose = () => {
    setDraftBackMenuOpen(false);
    panel?.handle.goBack();
  };

  return (
    <ComposeProvider value={ctxValue}>
      <Show when={!isMobile()}>
        <SplitHeaderLeft>
          <StaticSplitLabel
            class="ph-no-capture"
            label={ctxValue.subject() || previewName?.() || 'Draft email'}
            iconType="email"
            badges={[
              <SplitHeaderBadge text="draft" tooltip="This is a Draft Email" />,
            ]}
          />
        </SplitHeaderLeft>
      </Show>
      <div class="relative flex flex-col size-full min-h-0 overflow-hidden text-sm">
        <div class="macro-message-width sm:macro-message-padding mx-auto w-full min-h-120 max-h-full my-2 sm:my-12 touch:my-0 px-2 sm:px-4 touch:px-0 overflow-hidden touch:overflow-y-auto touch:scrollbar-hidden touch:min-h-full">
          <WrapUnlessMobile
            wrapper={(children) => (
              <Surface depth={2} class="rounded-xl border border-ink-muted/8">
                {children}
              </Surface>
            )}
          >
            <ComposeLayout
              toolbar={<EmailComposeToolbar editor={editor} />}
              notice={hasLinkError() ? <EmailPermissionsBanner /> : undefined}
              class="size-full p-4 bg-surface max-h-full touch:max-h-none overflow-hidden flex flex-col min-h-0 touch:min-h-full"
            />
          </WrapUnlessMobile>
        </div>
      </div>
      <Show when={isMobile()}>
        <MobileDrawer
          side="bottom"
          open={draftBackMenuOpen()}
          onOpenChange={setDraftBackMenuOpen}
          preventScroll={false}
          preventScrollbarShift={false}
        >
          <MobileDrawer.Portal>
            <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
            <MobileDrawer.Content aria-label="Draft options">
              <MobileDrawer.Handle />
              <MobileDrawer.Section class="mb-3">
                <button
                  type="button"
                  class="w-full bg-surface px-3 py-3.5 text-sm font-medium text-failure text-center not-last:mb-px"
                  onClick={async () => {
                    // Navigate only once the deletion landed; the mutation
                    // toasts on failure and the composer stays put.
                    try {
                      await deleteDraftAndReset();
                    } catch {
                      setDraftBackMenuOpen(false);
                      return;
                    }
                    leaveCompose();
                  }}
                >
                  Delete Draft
                </button>
                <button
                  type="button"
                  class="w-full bg-surface px-3 py-3.5 text-sm font-medium text-center"
                  onClick={leaveCompose}
                >
                  Save Draft
                </button>
              </MobileDrawer.Section>
            </MobileDrawer.Content>
          </MobileDrawer.Portal>
        </MobileDrawer>
      </Show>
    </ComposeProvider>
  );
}

function convertToContactInfoArray(
  recipients: WithCustomUserInput<'user' | 'contact'>[]
): ContactInfo[] {
  return recipients.map((recipient) => ({
    email: recipient.data.email,
    name:
      'name' in recipient.data ? recipient.data.name || undefined : undefined,
  }));
}
