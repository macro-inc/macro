import { MACRO_EMAIL_SIGNATURE } from '@app/features/email-compose/core/constants';
import { deviceLooksOffline } from '@core/util/connectivity';
import { $generateHtmlFromNodes } from '@lexical/html';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@macro-inc/lexical-core';
import * as EmailValidator from 'email-validator';
import type { LexicalEditor } from 'lexical';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { v7 as uuidv7 } from 'uuid';
import type {
  EmailContact,
  EmailMessage,
} from '../../email-message/core/email-message';
import {
  DraftPersistRejected,
  type EmailAttachmentStorage,
  type EmailComposeAccounts,
  type EmailComposeFeedback,
  type EmailComposeHost,
  type EmailDelivery,
  type EmailDraftStorage,
  type PersistedEmailIdentity,
} from '../context/compose-capabilities';
import { decodeBase64Utf8 } from '../core/decode-base64';
import type { EmailRecipient } from '../core/email-recipient';
import { plainTextToHtml } from '../core/plain-text-to-html';
import { convertEmailRecipientToContactInfo } from '../core/recipient-conversion';
import type {
  ComposeState,
  ComposeValidationError,
} from '../primitives/compose-view-state';
import type { EmailFormRecipients } from '../primitives/email-form-state';
import {
  createEmailFormState,
  type DraftFormAttachment,
} from '../primitives/email-form-state';
import {
  clearEmailBody,
  hasDraftContent,
  prepareEmailBody,
} from '../primitives/prepare-email-body';
import { endUndoSend } from '../primitives/undo-send-claim';
import { createAttachmentPersistence } from './attachment-persistence';
import { createDraftAutosave } from './draft-autosave';
import { createDraftSession } from './draft-session';
import { createEmailSendSchedule } from './email-send-schedule';
import { createEmailUndoStore } from './undo-store';

type UndoComposeSnapshot = {
  draftId: string;
  inboxId?: string;
  recipients: EmailFormRecipients;
  subject: string;
  bodyHtml: string;
  attachments: DraftFormAttachment[];
  includeSignature: boolean;
};

const composeUndo = createEmailUndoStore<UndoComposeSnapshot>();

export type EmailComposerOptions = {
  drafts: EmailDraftStorage;
  attachmentStorage: EmailAttachmentStorage;
  delivery: EmailDelivery;
  notices: EmailComposeFeedback;
  accounts: EmailComposeAccounts;
  viewerEmail: Accessor<string | undefined>;
  hasPaidAccess: Accessor<boolean>;
  recipients: Accessor<EmailRecipient[]>;
  recipientName(id: string): string;
  host?: EmailComposeHost;
  draft?: EmailMessage;
  /** Identity for a composer reopened from a local undo snapshot. */
  draftId?: string;
  recipientOptions?: Accessor<EmailRecipient[]>;
  onRecipientsChange?: (recipients: EmailRecipient[]) => void;
  /** Prefill for the To field (e.g. from an intercepted mailto: link). Ignored when editing an existing draft. */
  initialTo?: string[];
};

export function createEmailComposer(props: EmailComposerOptions) {
  const initialDraftId = props.draft?.db_id ?? props.draftId;
  const hasPaidAccess = props.hasPaidAccess;

  const form = createEmailFormState(
    {
      viewerEmail: props.viewerEmail,
      inboxes: props.accounts.inboxes,
    },
    initialDraftId
      ? {
          type: 'draft',
          messageId: initialDraftId,
        }
      : undefined,
    {
      getMessageById: () => props.draft,
      getDraftForMessageReply: () => undefined,
      onRecipientsChange: props.onRecipientsChange,
    }
  );

  const primaryInboxId = props.accounts.primaryId;
  const link = createMemo(() => {
    const inboxes = props.accounts.inboxes();
    if (inboxes.length === 0) return undefined;
    // Send from the inbox the user picked, else the inbox that owns the draft
    // being edited, else the primary inbox — not whichever inbox sorts first.
    const targetId =
      form.selectedInboxId() ?? props.draft?.link_id ?? primaryInboxId();
    return inboxes.find((inbox) => inbox.id === targetId) ?? inboxes[0];
  });

  const activeInboxId = () => link()?.id;

  // The sending inbox's saved signature (empty for inboxes without one). New
  // emails include it by default; the preview's dismiss drops it for this one
  // message. The backend injects it on send (see include_signature below); the
  // FE only renders the preview and signals an explicit dismiss.
  const signature = () => link()?.settings.signature ?? undefined;
  const [includeSignature, setIncludeSignature] = createSignal(true);

  const hasInboxError = createMemo(() => {
    if (props.accounts.loading()) return false;
    return props.accounts.failed() || props.accounts.inboxes().length === 0;
  });

  const destinationOptions = props.recipients;

  const [editor, setEditor] = createSignal<LexicalEditor | undefined>();
  const [content, setContent] = createSignal('');
  // The draft's persisted identity — and whether the server has confirmed
  // it, which the REST-only send and schedule depend on. The thread it lives
  // under is part of it: switching the sending inbox re-homes the draft
  // server-side, so the previous thread's soup row must be dropped after
  // the save.
  const session = createDraftSession(
    initialDraftId
      ? { draftId: initialDraftId, threadId: props.draft?.thread_db_id }
      : undefined
  );
  const currentDraftId = session.draftId;
  const currentThreadId = session.threadId;

  const attachmentPersistence = createAttachmentPersistence({
    services: props.attachmentStorage,
    attachments: form.attachments,
    draftId: currentDraftId,
    inboxId: activeInboxId,
  });

  // Restore form state from undo-send snapshot if available
  const restoredSnapshot = initialDraftId
    ? composeUndo.take(initialDraftId)
    : undefined;

  if (restoredSnapshot) {
    form.setSelectedInbox(restoredSnapshot.inboxId);
    form.setRecipients('to', restoredSnapshot.recipients.to);
    form.setRecipients('cc', restoredSnapshot.recipients.cc);
    form.setRecipients('bcc', restoredSnapshot.recipients.bcc);
    form.setSubject(restoredSnapshot.subject);
    for (const attachment of restoredSnapshot.attachments) {
      form.attachments.add(attachment);
    }
    setIncludeSignature(restoredSnapshot.includeSignature);
  }

  if (!initialDraftId && props.initialTo?.length) {
    form.setRecipients(
      'to',
      props.initialTo.map((email) => ({
        kind: 'custom' as const,
        id: `macro|${email}`,
        data: {
          id: `macro|${email}`,
          email,
          invalid: !EmailValidator.validate(email),
        },
      }))
    );
  }

  // --- Draft persistence ---

  function collectDraft() {
    $removeAllWatermarkNodes(editor());
    const prepared = prepareEmailBody(editor());
    if (!prepared) {
      props.notices.reportError(
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

  // The server rejected this draft as already sent from another device: its
  // outcome supersedes the local draft, so drop content and identity (the
  // thread handle included, so the next compose cannot attach a draft to
  // the sent thread). The session's epoch bump makes in-flight
  // continuations stale; discarding pauses the save that clearing schedules.
  const handleAlreadySent = () => {
    props.notices.feedback.alert('This email was already sent');
    setDiscarding(true);
    autosave.cancel();
    try {
      resetState();
    } finally {
      setDiscarding(false);
    }
  };
  // A deterministic rejection is the session's to record (latch autosave,
  // or drop the draft on already-sent); transport failures just reject and
  // the next save may retry them.
  const recordRejection = (error: unknown, epoch: number) => {
    if (!(error instanceof DraftPersistRejected) || session.isStale(epoch))
      return;
    session.dispatch({ type: 'rejected', epoch, code: error.code });
    if (error.code === 'DRAFT_ALREADY_SENT') handleAlreadySent();
  };

  async function persistDraft(
    draftToSave: ReturnType<typeof collectDraft>,
    saveInboxId: string | undefined
  ) {
    if (!draftToSave) {
      const draftId = currentDraftId();
      const epoch = session.epoch();
      if (draftId) {
        try {
          await props.drafts.deleteDraft({
            draftId: draftId,
            threadId: currentThreadId(),
            inboxId: saveInboxId,
          });
        } catch (error) {
          recordRejection(error, epoch);
          throw error;
        }
      }
      if (session.isStale(epoch)) return;
      session.dispatch({ type: 'emptied' });
      return;
    }
    // Latched after a deterministic rejection: the content stays in the
    // editor, but the same save must never be replayed on its own. Checked
    // after the empty branch so clearing the draft still runs, and lifts it.
    if (!session.autosaveAllowed()) return;

    // Identity is local-first: draft AND thread handles minted before the
    // first dispatch, so every queued save for this compose resolves to one
    // server draft in one thread — even when the responses arrive after an
    // app restart. The server maps handles to server-minted rows; a
    // committed save's ids are adopted below. Minted v7 (best effort, never
    // trusted) to keep the mapping index friendly.
    const previousThreadId = currentThreadId();
    if (!session.draftId()) {
      session.dispatch({
        type: 'minted',
        draftId: uuidv7(),
        threadId: uuidv7(),
      });
    }
    const identity = session.identity();
    const epoch = session.epoch();
    let draftResponse: PersistedEmailIdentity;
    try {
      draftResponse = await props.drafts.saveDraft({
        draft: {
          ...draftToSave,
          // Only server-confirmed ids travel in the draft; minted handles go
          // apart, since a REST save cannot resolve them.
          db_id: identity.kind === 'server' ? identity.draftId : undefined,
          thread_db_id:
            identity.kind === 'server' ? identity.threadId : undefined,
        },
        clientHandles:
          identity.kind === 'handle'
            ? { draftId: identity.draftId, threadId: identity.threadId }
            : undefined,
        inboxId: saveInboxId,
        previousThreadId,
      });
    } catch (error) {
      recordRejection(error, epoch);
      throw error;
    }
    // Reset while the save was on the wire (a send, a discard, another
    // save's already-sent outcome): the answer belongs to a draft the user
    // already dropped. Adopting its ids or uploading — the upload reads the
    // live form, which may already hold the next draft's files — would
    // re-plant that draft into the fresh composer.
    if (session.isStale(epoch)) return;
    session.dispatch({ type: 'saved', epoch, identity: draftResponse });
    const draftId = draftResponse.draftId;
    if (!draftId) return;

    if (draftResponse.persistence === 'queued') {
      // Durably queued under client handles. Local attachments are not on
      // the durable queue yet (a later change moves them there), so they
      // upload over REST right away — offline, or against a handle the
      // server has not seen, that fails out the way an offline attachment
      // does today: the upload's own notice, file kept for the next save.
      // The miss is not the save's failure.
      await attachmentPersistence
        .upload(draftId, { inboxId: saveInboxId })
        .catch(() => undefined);
      return draftId;
    }
    await attachmentPersistence.upload(draftId, { inboxId: saveInboxId });
    return draftId;
  }

  // Edits since the composer opened; an untouched existing draft can be
  // left without the keep-or-delete prompt.
  const [draftDirty, setDraftDirty] = createSignal(false);

  const [sendPhase, setSendPhase] = createSignal<
    'idle' | 'preparing' | 'sending'
  >('idle');
  const submitting = () => sendPhase() !== 'idle';
  const sending = () => sendPhase() === 'sending';
  const [discarding, setDiscarding] = createSignal(false);
  let completed = false;
  const persistencePaused = () => submitting() || discarding() || completed;

  const autosave = createDraftAutosave({
    capture: () => ({ draft: collectDraft(), inboxId: activeInboxId() }),
    persist: ({ draft, inboxId }) => persistDraft(draft, inboxId),
    paused: persistencePaused,
  });
  const markDirtyAndScheduleSave = () => {
    if (persistencePaused()) return;
    setDraftDirty(true);
    autosave.schedule();
  };

  // --- Attachment handling ---

  const handleAddAttachments = async (attachments: DraftFormAttachment[]) => {
    // Attachments cannot be added while offline: a queued draft save durably
    // carries only the draft's text, while attached file bytes live solely in
    // the open composer's memory and upload only on a later save that
    // commits. Rather than accept an attachment that can silently miss the
    // draft, refuse at attach time.
    if (deviceLooksOffline()) {
      await props.notices.blockingNotice({
        title: "You're offline",
        body: "Attachments can't be added while you're offline. Reconnect and try again.",
      });
      return;
    }
    for (const attachment of attachments) {
      form.attachments.add(attachment);
    }
    markDirtyAndScheduleSave();
  };

  const handleRemoveAttachment = (attachment: DraftFormAttachment) => {
    setDraftDirty(true);
    attachmentPersistence.remove(attachment);
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

  const [validationError, setValidationError] =
    createSignal<ComposeValidationError | null>(null);

  // Everything that follows a successful unschedule: scrub the new thread's
  // cache, restore the server-side draft, and remount the compose view so it
  // restores the form from the undo snapshot.
  const restoreAfterUndoSend = async (
    draftId: string,
    threadId: string | undefined,
    inboxId: string | undefined
  ) => {
    const snapshot = composeUndo.peek(draftId);
    await props.drafts.restoreDraft({
      draftId,
      threadId,
      draft: snapshot
        ? {
            bcc: snapshot.recipients.bcc.map(
              convertEmailRecipientToContactInfo
            ),
            cc: snapshot.recipients.cc.map(convertEmailRecipientToContactInfo),
            db_id: draftId,
            subject: snapshot.subject,
            to: snapshot.recipients.to.map(convertEmailRecipientToContactInfo),
          }
        : undefined,
      html: snapshot?.bodyHtml,
      inboxId,
    });

    props.host?.showDraft?.(draftId);
  };

  // Undo retains the inbox used by the send even after navigation.
  const undoSend = (
    draftId: string,
    threadId: string | undefined,
    inboxId: string | undefined
  ) =>
    props.delivery.undoSend({
      threadId,
      draftId,
      inboxId,
      onUndone: () => restoreAfterUndoSend(draftId, threadId, inboxId),
    });

  const afterSend = (
    identity: PersistedEmailIdentity,
    inboxId: string | undefined
  ) => {
    const draftId = identity.draftId;
    const threadId = identity.threadId;
    if (draftId) endUndoSend(draftId);
    try {
      const toastId = props.notices.feedback.success('Email sent', {
        actions: draftId
          ? [
              {
                label: 'Undo',
                onClick: () => {
                  if (toastId != null) props.notices.feedback.dismiss(toastId);
                  void undoSend(draftId, threadId ?? undefined, inboxId).catch(
                    props.notices.reportError
                  );
                },
              },
            ]
          : undefined,
        duration: 5_000,
      });
    } catch (error) {
      props.notices.reportError(error);
    }
    try {
      if (threadId) props.host?.showThread?.(threadId);
    } catch (error) {
      props.notices.reportError(error);
    }
  };

  const onSubmit = async () => {
    if (scheduling() || persistencePaused()) return;
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

    // Sending is a REST call that resolves server ids only and is never
    // queued (email send moves onto the durable queue in a later change).
    // Offline, the pre-send save below can only queue, leaving handles the
    // send cannot resolve — refuse outright, with a clear reason.
    if (deviceLooksOffline()) {
      props.notices.feedback.failure('Failed to send email', {
        subtext: "You're offline",
      });
      return;
    }

    setSendPhase('preparing');
    try {
      // Ensure the draft is saved before sending so undo-send always has a
      // draft id to snapshot and restore (the send reuses the draft's db_id).
      autosave.cancel();
      const epochBeforeSave = session.epoch();
      try {
        await autosave.save();
      } catch {
        // Draft save is best-effort; the send still works without one.
      }
      // The save can learn the email was already sent from another device
      // and reset the composer; the recipients captured above would
      // otherwise go out on an empty message.
      if (session.isStale(epochBeforeSave)) return;
      // A queued pre-send save left client handles the REST send cannot
      // resolve (offline detection missed, or a first save still holds the
      // queue head). Ask for a retry while the content is still here.
      if (session.identity().kind === 'handle') {
        props.notices.feedback.failure('Failed to send email', {
          subtext: 'Draft still syncing, try again',
        });
        return;
      }
      // A local attachment still without a record did not upload — the
      // best-effort save above swallowed it — and the upload has already
      // reported it. Sending now would silently drop it.
      if (
        form.attachments
          .list()
          .some((a) => a.type === 'local' && !a.attachmentId)
      ) {
        props.notices.feedback.failure('Failed to send email', {
          subtext: 'Attachment not uploaded',
        });
        return;
      }

      // Scheduling may have started while the draft save was pending.
      if (scheduling() || form.sendTime()) return;

      // Snapshot editor state before watermark so undo-send can restore it
      if (currentEditor) {
        const snapshotHtml = currentEditor.read(() =>
          $generateHtmlFromNodes(currentEditor)
        );
        const draftId = currentDraftId();
        if (draftId) {
          composeUndo.remember({
            inboxId: currentLink.id,
            draftId,
            recipients: structuredClone(unwrap(form.recipients())),
            subject: form.subject(),
            bodyHtml: snapshotHtml,
            attachments: [...form.attachments.list()],
            includeSignature: includeSignature(),
          });
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

      try {
        setSendPhase('sending');
        const result = await props.delivery.sendMessage({
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
            db_id: currentDraftId(),
            // Backend includes the signature by default for new emails; only signal
            // an explicit dismiss. Omitting it falls through to the backend default.
            include_signature: includeSignature() ? undefined : false,
          },
          inboxId: activeInboxId(),
        });

        completed = true;
        // The draft is sent: nothing still on the wire belongs to it.
        session.dispatch({ type: 'reset' });
        afterSend(result, currentLink.id);
      } finally {
        cleanupWatermark();
      }
    } catch (error) {
      props.notices.reportError(error);
      if (!completed) props.notices.feedback.failure('Failed to send email');
    } finally {
      setSendPhase('idle');
    }
  };

  // --- Schedule ---

  const totalRecipientCount = () => {
    const recipients = form.recipients();
    return recipients.to.length + recipients.cc.length + recipients.bcc.length;
  };
  const schedule = createEmailSendSchedule({
    delivery: props.delivery,
    notices: props.notices,
    draftId: currentDraftId,
    saveDraft: async () => {
      const draftId = await autosave.save();
      // The schedule endpoint resolves server ids only; a queued save's
      // handle reads as "no draft" so scheduling fails before the wire.
      return session.restSendable() ? draftId : undefined;
    },
    threadId: currentThreadId,
    inboxId: activeInboxId,
    sendTime: form.sendTime,
    setSendTime: (date) => {
      form.setSendTime(date);
      setDraftDirty(true);
    },
    recipientCount: totalRecipientCount,
  });
  const scheduling = schedule.pending;
  const scheduleBlocked = () => sending() || discarding() || completed;
  const handleSendTimeChange = (date: Date | null) => {
    if (scheduleBlocked()) return Promise.resolve();
    return schedule.change(date);
  };

  // --- Reset / delete ---

  const resetState = () => {
    clearEmailBody(editor());
    setContent('');
    session.dispatch({ type: 'reset' });
    form.clear();
  };

  const deleteDraftAndReset = async () => {
    if (persistencePaused() || scheduling()) return false;
    setDiscarding(true);
    autosave.cancel();
    try {
      // A first save may still be creating the draft. Delete its returned ID
      // after it settles so discard cannot leave an orphan behind.
      await autosave.settled().catch(() => {});
      const draftId = currentDraftId();
      if (draftId) {
        try {
          await props.drafts.deleteDraft({
            draftId,
            threadId: currentThreadId(),
            inboxId: activeInboxId(),
          });
        } catch (error) {
          // Sent from another device: the reset below is exactly what that
          // outcome asks for. Anything else keeps the draft.
          if (
            !(error instanceof DraftPersistRejected) ||
            error.code !== 'DRAFT_ALREADY_SENT'
          )
            throw error;
          props.notices.feedback.alert('This email was already sent');
        }
      }
      resetState();
      return true;
    } finally {
      setDiscarding(false);
    }
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
    const fromDraft = props.recipientOptions?.();
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
        recipientName = props.recipientName(recipients[0].data.id);
      }

      return recipientName ? `Email to ${recipientName}` : 'Draft email';
    }

    const names = recipients
      .slice(0, 2)
      .map((r) => {
        if (r.kind === 'user') {
          return props.recipientName(r.data.id);
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

  const ctxValue: ComposeState = {
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
    onDelete: () => void deleteDraftAndReset().catch(() => {}),
    onSendTimeChange: handleSendTimeChange,

    // Status
    disabled: () => hasInboxError() || persistencePaused() || scheduling(),
    isSending: submitting,
    hasDraft: () => currentDraftId() != null,

    // Validation
    validationError: (type) => {
      const error = validationError();
      if (error?.type === type) return error;
      return undefined;
    },

    // Recipients
    recipientOptions: getRecipientOptions,
    focusRecipientsOnMount: !hasInboxError(),

    // Schedule send
    scheduleSendDisabled: () =>
      totalRecipientCount() === 0 || scheduling() || persistencePaused(),

    // Display
    fromAddress: () => link()?.email_address,
    fromInboxes: () => props.accounts.inboxes() ?? [],
    selectedInboxId: () => link()?.id,
    // Persist immediately on a sender switch so the draft moves to the new
    // inbox even without a text edit.
    onSelectInbox: (inboxId) => {
      if (persistencePaused() || scheduling()) return;
      form.setSelectedInbox(inboxId);
      setDraftDirty(true);
      autosave.cancel();
      void autosave.save().catch(() => {});
    },
    hasPaidAccess,
  };
  return {
    context: ctxValue,
    editor,
    previewName,
    hasInboxError,
    draftDirty,
    deleteDraftAndReset,
    signature,
    includeSignature,
    setIncludeSignature,
  };
}

function convertToContactInfoArray(
  recipients: EmailRecipient[]
): EmailContact[] {
  return recipients.map((recipient) => ({
    email: recipient.data.email,
    name:
      'name' in recipient.data ? recipient.data.name || undefined : undefined,
  }));
}
