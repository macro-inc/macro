import { MACRO_EMAIL_SIGNATURE } from '@app/features/email-compose/core/constants';
import { $generateHtmlFromNodes } from '@lexical/html';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@macro-inc/lexical-core';
import * as EmailValidator from 'email-validator';
import type { LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import { unwrap } from 'solid-js/store';
import type {
  EmailContact,
  EmailMessage,
} from '../../email-message/core/email-message';
import type {
  EmailAttachmentStorage,
  EmailComposeAccounts,
  EmailComposeFeedback,
  EmailComposeHost,
  EmailConnectivity,
  EmailDelivery,
  EmailDraftLifecycleSource,
  EmailDraftStorage,
  PersistedEmailIdentity,
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
import {
  createAttachmentPersistence,
  refuseAttachmentsOffline,
} from './attachment-persistence';
import { createDraftAutosave } from './draft-autosave';
import {
  createDraftPersistence,
  deleteDraftForDiscard,
} from './draft-persistence';
import { createDraftSession } from './draft-session';
import { createEmailSendSchedule } from './email-send-schedule';
import {
  refuseSend,
  sendRefusalAfterSave,
  sendRefusalBeforeSave,
} from './send-readiness';
import { createEmailUndoStore } from './undo-store';

type UndoComposeSnapshot = {
  draftId: string;
  threadId?: string;
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
  draftLifecycle: EmailDraftLifecycleSource;
  notices: EmailComposeFeedback;
  accounts: EmailComposeAccounts;
  connectivity: EmailConnectivity;
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
  const restoredSnapshot = initialDraftId
    ? composeUndo.take(initialDraftId)
    : undefined;
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
  // The selected sender can change before the server migrates the draft.
  // Lifecycle reads always use one complete persisted identity.
  const [savedDraft, setSavedDraft] = createSignal<
    Partial<PersistedEmailIdentity> | undefined
  >(
    initialDraftId
      ? {
          draftId: initialDraftId,
          threadId: restoredSnapshot?.threadId ?? props.draft?.thread_db_id,
          inboxId: restoredSnapshot?.inboxId ?? props.draft?.link_id,
        }
      : undefined
  );
  const currentDraftId = () => savedDraft()?.draftId;
  const currentThreadId = () => savedDraft()?.threadId;
  const persistedInboxId = () => savedDraft()?.inboxId;
  const [movingInbox, setMovingInbox] = createSignal(false);
  let identityVersion = 0;
  let editVersion = 0;
  let persistedEditVersion = 0;
  const lifecycle = props.draftLifecycle.observe({
    draftId: currentDraftId,
    threadId: currentThreadId,
    inboxId: persistedInboxId,
  });

  const attachmentPersistence = createAttachmentPersistence({
    services: props.attachmentStorage,
    attachments: form.attachments,
    draftId: currentDraftId,
    inboxId: activeInboxId,
  });

  // Restore form state from undo-send snapshot if available
  if (restoredSnapshot) {
    session.dispatch({
      type: 'seeded',
      draftId: restoredSnapshot.draftId,
      threadId: restoredSnapshot.threadId,
    });
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

  async function reportPersistenceFailure(
    error: unknown,
    operation: 'save' | 'delete'
  ) {
    props.notices.reportError(error);
    let state;
    try {
      state = await lifecycle.refresh();
    } catch (refreshError) {
      props.notices.reportError(refreshError);
    }
    if (
      state &&
      state.draftId === currentDraftId() &&
      state.threadId === currentThreadId() &&
      state.inboxId === persistedInboxId()
    ) {
      if (state.type !== 'editing') {
        // Abort an awaiting Send directly. The reactive lifecycle effect may
        // apply this observation after the save rejection resumes.
        identityVersion += 1;
      }
      if (state.type === 'sent') {
        props.notices.feedback.alert(
          'This scheduled email was sent. Your composer has been updated.'
        );
        return;
      }
    }
    props.notices.feedback.failure(`Failed to ${operation} draft`);
  }

  async function persistDraft({
    draft: draftToSave,
    inboxId: saveInboxId,
    generation,
    revision,
  }: {
    draft: ReturnType<typeof collectDraft>;
    inboxId: string | undefined;
    generation: number;
    revision: number;
  }) {
    if (generation !== identityVersion) return;
    if (!draftToSave) {
      const draftId = currentDraftId();
      if (draftId) {
        try {
          await props.drafts.deleteDraft({
            draftId: draftId,
            threadId: currentThreadId(),
            inboxId: saveInboxId,
          });
        } catch (error) {
          await reportPersistenceFailure(error, 'delete');
          throw error;
        }
      }
      if (generation !== identityVersion) return;
      setSavedDraft(undefined);
      persistedEditVersion = Math.max(persistedEditVersion, revision);
      return;
    }

    const previousThreadId = currentThreadId();
    let draftResponse;
    try {
      draftResponse = await props.drafts.saveDraft({
        draft: {
          ...draftToSave,
          db_id: currentDraftId(),
        },
        inboxId: saveInboxId,
        previousThreadId: previousThreadId,
      });
    } catch (error) {
      await reportPersistenceFailure(error, 'save');
      throw error;
    }

    // A delivery, cancellation, deletion, or detach won while this request was
    // in flight. Its response must never restore the obsolete draft identity.
    if (generation !== identityVersion) return;

    persistedEditVersion = Math.max(persistedEditVersion, revision);
    setSavedDraft(draftResponse);

    const draftId = draftResponse.draftId;
    if (draftId) {
      await attachmentPersistence.upload(draftId, { inboxId: saveInboxId });
      if (generation !== identityVersion) return;
      return draftId;
    }
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
  const [completed, setCompleted] = createSignal(false);
  const [terminalState, setTerminalState] = createSignal<
    'sent' | 'missing' | undefined
  >();
  const persistencePaused = () =>
    submitting() ||
    discarding() ||
    movingInbox() ||
    completed() ||
    !!form.sendTime();

  const autosave = createDraftAutosave({
    capture: () => ({
      draft: collectDraft(),
      inboxId: activeInboxId(),
      generation: identityVersion,
      revision: editVersion,
    }),
    persist: persistDraft,
    paused: persistencePaused,
  });
  const markDirtyAndScheduleSave = () => {
    if (persistencePaused()) return;
    editVersion += 1;
    setDraftDirty(true);
    autosave.schedule();
  };

  // --- Attachment handling ---

  const handleAddAttachments = (attachments: DraftFormAttachment[]) => {
    if (persistencePaused()) return;
    for (const attachment of attachments) {
      form.attachments.add(attachment);
    }
    markDirtyAndScheduleSave();
  };

  const handleRemoveAttachment = (attachment: DraftFormAttachment) => {
    if (persistencePaused()) return;
    editVersion += 1;
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
    if (form.sendTime()) {
      props.notices.feedback.alert(
        'This email is already scheduled. Cancel the schedule before sending it now.'
      );
      return;
    }
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

    setSendPhase('preparing');
    const sendGeneration = identityVersion;
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
      // Already sent from another device: the composer was reset mid-save.
      if (session.isStale(epochBeforeSave)) return;
      const identity = session.identity();
      const refusal = sendRefusalAfterSave({
        identity,
        autosaveAllowed: session.autosaveAllowed(),
        attachments: form.attachments.list(),
        // A failed REST save leaves unused handles; the send can still create the message.
        unqueuedHandleMaySend: true,
      });
      if (refusal) return refuseSend(props.notices, refusal);

      // Scheduling may have started while the draft save was pending.
      if (
        sendGeneration !== identityVersion ||
        completed() ||
        terminalState() ||
        scheduling() ||
        form.sendTime()
      )
        return;

      const draftId = identity.kind === 'server' ? identity.draftId : undefined;
      // Snapshot editor state before watermark so undo-send can restore it
      if (currentEditor) {
        const snapshotHtml = currentEditor.read(() =>
          $generateHtmlFromNodes(currentEditor)
        );
        if (draftId) {
          composeUndo.remember({
            inboxId: currentLink.id,
            draftId,
            threadId: currentThreadId(),
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
            db_id: draftId,
            // Backend includes the signature by default for new emails; only signal
            // an explicit dismiss. Omitting it falls through to the backend default.
            include_signature: includeSignature() ? undefined : false,
          },
          inboxId: activeInboxId(),
        });

        setCompleted(true);
        afterSend(result, currentLink.id);
      } finally {
        cleanupWatermark();
      }
    } catch (error) {
      props.notices.reportError(error);
      if (!completed()) props.notices.feedback.failure('Failed to send email');
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
    saveDraft: async () => persistence.confirmed(await autosave.save()),
    threadId: currentThreadId,
    inboxId: activeInboxId,
    sendTime: form.sendTime,
    setSendTime: form.setSendTime,
    recipientCount: totalRecipientCount,
    reconcile: lifecycle.refresh,
  });
  const scheduling = schedule.pending;
  const scheduleBlocked = () =>
    sending() || discarding() || movingInbox() || completed();
  const handleSendTimeChange = (date: Date | null) => {
    if (scheduleBlocked()) return Promise.resolve(false);
    return schedule.change(date);
  };

  // --- Reset / delete ---

  const resetState = () => {
    clearEmailBody(editor());
    setContent('');
    setSavedDraft(undefined);
    form.clear();
    setTerminalState(undefined);
  };

  const deleteDraftAndReset = async () => {
    if (form.sendTime()) {
      props.notices.feedback.alert(
        'Cancel the schedule before deleting this draft.'
      );
      return false;
    }
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
          await reportPersistenceFailure(error, 'delete');
          setDiscarding(false);
          void lifecycle.refresh().catch(props.notices.reportError);
          throw error;
        }
      }
      identityVersion += 1;
      resetState();
      return true;
    } finally {
      setDiscarding(false);
    }
  };

  const detachFromObsoleteDraft = (message: string) => {
    identityVersion += 1;
    autosave.cancel();
    setSavedDraft(undefined);
    const omittedAttachments = attachmentPersistence.detach();
    form.setSendTime(null);
    setCompleted(false);
    setTerminalState(undefined);
    persistedEditVersion = 0;
    props.notices.feedback.alert(message);
    if (omittedAttachments) {
      props.notices.feedback.alert(
        'Previously saved attachments could not be copied to the new draft. Please attach those files again.'
      );
    }
    void autosave.save().catch(() => {});
  };

  let lastScheduledTime = form.sendTime()?.toISOString();
  let handledTerminalIdentity: string | undefined;
  createEffect(
    on(
      [lifecycle.state, scheduling, movingInbox],
      ([state, schedulePending, moving]) => {
        if (
          !state ||
          state.draftId !== currentDraftId() ||
          state.threadId !== currentThreadId() ||
          (state.inboxId !== undefined &&
            state.inboxId !== persistedInboxId()) ||
          schedulePending ||
          moving ||
          discarding()
        )
          return;

        if (state.type === 'scheduled') {
          if (editVersion > persistedEditVersion) {
            detachFromObsoleteDraft(
              'This email was scheduled in another tab. Your newer text was kept as a new draft.'
            );
            return;
          }
          const nextTime = new Date(state.sendTime);
          const changedElsewhere =
            !form.sendTime() ||
            form.sendTime()?.getTime() !== nextTime.getTime();
          form.setSendTime(nextTime);
          if (changedElsewhere && lastScheduledTime !== state.sendTime) {
            props.notices.feedback.alert(
              `Email scheduled for ${nextTime.toLocaleString()}. Cancel the schedule to edit.`
            );
          }
          lastScheduledTime = state.sendTime;
          return;
        }

        if (state.type === 'editing') {
          if (form.sendTime()) {
            form.setSendTime(null);
            lastScheduledTime = undefined;
            props.notices.feedback.success(
              'Schedule cancelled. This email is editable again.'
            );
          }
          return;
        }

        if (handledTerminalIdentity === `${state.draftId}:${state.type}`)
          return;
        handledTerminalIdentity = `${state.draftId}:${state.type}`;
        if (editVersion > persistedEditVersion) {
          detachFromObsoleteDraft(
            state.type === 'sent'
              ? 'The scheduled email was sent while you were editing. Your newer text was kept as a new draft and was not sent.'
              : 'The draft changed elsewhere. Your newer text was kept as a new draft.'
          );
          return;
        }

        identityVersion += 1;
        autosave.cancel();
        form.setSendTime(null);
        setCompleted(true);
        setTerminalState(state.type);
        if (state.type === 'sent') {
          props.notices.feedback.success('Scheduled email sent');
          props.host?.showThread?.(state.threadId);
        } else {
          props.notices.feedback.alert('This draft is no longer available.');
          props.host?.goBack?.();
        }
      }
    )
  );

  const selectInbox = async (inboxId: string) => {
    if (
      submitting() ||
      discarding() ||
      movingInbox() ||
      completed() ||
      form.sendTime() ||
      scheduling()
    )
      return;
    setMovingInbox(true);
    try {
      form.setSelectedInbox(inboxId);
      editVersion += 1;
      setDraftDirty(true);
      autosave.cancel();
      await autosave.save();
    } catch {
      // Persistence reports failures; replay lifecycle after the move settles.
    } finally {
      setMovingInbox(false);
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
      if (persistencePaused() || scheduling()) return;
      form.setRecipients(field, value);
      markDirtyAndScheduleSave();
    },
    setSubject: (value) => {
      if (persistencePaused() || scheduling()) return;
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
    deliveryState: () =>
      terminalState() ?? (form.sendTime() ? 'scheduled' : 'draft'),
    sendUnavailableReason: () => {
      const sendTime = form.sendTime();
      if (sendTime)
        return `Already scheduled for ${sendTime.toLocaleString()}. Open the schedule control to reschedule or cancel.`;
      if (terminalState() === 'sent')
        return 'This email has already been sent.';
      if (terminalState() === 'missing')
        return 'This draft is no longer available.';
      if (scheduling()) return 'Saving schedule…';
      if (submitting()) return 'Sending…';
      return undefined;
    },

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
      totalRecipientCount() === 0 || scheduling() || scheduleBlocked(),

    // Display
    fromAddress: () => link()?.email_address,
    fromInboxes: () => props.accounts.inboxes() ?? [],
    selectedInboxId: () => link()?.id,
    // Persist immediately on a sender switch so the draft moves to the new
    // inbox even without a text edit.
    onSelectInbox: (inboxId) => {
      void selectInbox(inboxId);
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
