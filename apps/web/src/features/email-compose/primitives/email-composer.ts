import { MACRO_EMAIL_SIGNATURE } from '@app/features/email-compose/core/constants';
import { $generateHtmlFromNodes } from '@lexical/html';
import {
  $appendWatermarkNodeToLast,
  $removeAllWatermarkNodes,
} from '@macro-inc/lexical-core';
import { debounce } from '@solid-primitives/scheduled';
import * as EmailValidator from 'email-validator';
import type { LexicalEditor } from 'lexical';
import { createEffect, createMemo, createSignal, on } from 'solid-js';
import { unwrap } from 'solid-js/store';
import type { EmailContact } from '../../email-message/core/email-message';
import type {
  EmailComposeHost,
  EmailComposeServices,
} from '../context/compose-services';
import type { EmailReplySession } from '../context/email-form-dependencies';
import { decodeBase64Utf8 } from '../core/decode-base64';
import type { EmailRecipient } from '../core/email-recipient';
import { plainTextToHtml } from '../core/plain-text-to-html';
import { convertEmailRecipientToContactInfo } from '../core/recipient-conversion';
import { createComposeOperation } from '../primitives/compose-operation';
import type {
  ComposeContextValue,
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
import { createEmailUndoStore } from './undo-store';

const DRAFT_DEBOUNCE_MS = 500;

type UndoComposeSnapshot = {
  draftId: string;
  recipients: EmailFormRecipients;
  subject: string;
  bodyHtml: string;
  attachments: DraftFormAttachment[];
  includeSignature: boolean;
};

const composeUndo = createEmailUndoStore<UndoComposeSnapshot>();

export type EmailComposeInput = {
  services: EmailComposeServices;
  host?: EmailComposeHost;
  session?: EmailReplySession;
  draftID?: string;
  /** Prefill for the To field (e.g. from an intercepted mailto: link). Ignored when editing an existing draft. */
  initialTo?: string[];
};

export function createEmailComposer(props: EmailComposeInput) {
  const services = props.services;
  const [scheduling, setScheduling] = createSignal(false);
  const hasPaidAccess = services.hasPaidAccess;
  const uploadAttachmentMutation = createComposeOperation(
    services.uploadAttachments
  );
  const saveDraftMutation = createComposeOperation(services.saveDraft);
  const deleteDraftMutation = createComposeOperation(services.deleteDraft);
  const emailContext = props.session;

  const form = createEmailFormState(
    {
      viewerEmail: services.viewerEmail,
      inboxes: services.accounts.inboxes,
    },
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

  const primaryLinkId = services.accounts.primaryId;
  const link = createMemo(() => {
    const data = { links: services.accounts.inboxes() };
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

  const toHeaderLinkId = services.accounts.headerId;
  // Scope writes to the inbox this compose sends from (its X-Email-Link-Id
  // header), so a non-primary "from" inbox drafts/sends from the right account.
  const headerLinkId = () => toHeaderLinkId(link()?.id);

  // The sending inbox's saved signature (empty for inboxes without one). New
  // emails include it by default; the preview's dismiss drops it for this one
  // message. The backend injects it on send (see include_signature below); the
  // FE only renders the preview and signals an explicit dismiss.
  const signature = () => link()?.settings.signature ?? undefined;
  const [includeSignature, setIncludeSignature] = createSignal(true);

  const hasLinkError = createMemo(() => {
    if (services.accounts.loading()) return false;
    return (
      services.accounts.failed() || services.accounts.inboxes().length === 0
    );
  });

  const destinationOptions = services.recipients;

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
  const restoredSnapshot = props.draftID
    ? composeUndo.take(props.draftID)
    : undefined;

  if (restoredSnapshot) {
    form.setRecipients('to', restoredSnapshot.recipients.to);
    form.setRecipients('cc', restoredSnapshot.recipients.cc);
    form.setRecipients('bcc', restoredSnapshot.recipients.bcc);
    form.setSubject(restoredSnapshot.subject);
    for (const attachment of restoredSnapshot.attachments) {
      form.attachments.add(attachment);
    }
    setIncludeSignature(restoredSnapshot.includeSignature);
  }

  if (!props.draftID && props.initialTo?.length) {
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
      services.reportError(
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

  // Content uploads still in flight, including ones started by earlier saves.
  // attachmentID only proves the draft record exists, and the send path treats
  // a resolved save as "attachments ready", so a save must not resolve while
  // any of these are pending.
  const inFlightAttachmentUploads = new Set<Promise<void>>();

  async function executeSaveDraft() {
    if (sendMutation.pending()) {
      return;
    }
    const draftToSave = collectDraft();
    if (!draftToSave) {
      const draftID = currentDraftID();
      if (draftID) {
        await deleteDraftMutation.run({
          draftId: draftID,
          threadId: currentThreadID(),
          linkId: headerLinkId(),
        });
      }
      setCurrentDraftID(undefined);
      return;
    }

    const previousThreadID = currentThreadID();
    const draftResponse = await saveDraftMutation.run({
      draft: {
        ...draftToSave,
        db_id: currentDraftID(),
      },
      linkId: headerLinkId(),
    });

    const newThreadID = draftResponse.draft.thread_db_id ?? undefined;
    if (previousThreadID && previousThreadID !== newThreadID) {
      services.invalidatePreview(previousThreadID);
      services.refreshThreadPreview(previousThreadID);
    }
    setCurrentThreadID(newThreadID);

    const draftId = draftResponse.draft.db_id;
    if (draftId) {
      const attachments = form.attachments
        .list()
        .filter((a) => a.type === 'local' && !a.attachmentID) as Extract<
        DraftFormAttachment,
        { type: 'local' }
      >[];

      let uploadRun: Promise<void> | undefined;
      if (attachments.length) {
        uploadRun = uploadAttachmentMutation.run({
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

      while (inFlightAttachmentUploads.size) {
        await Promise.all([...inFlightAttachmentUploads]);
      }
      // Settled by the drain above, this only rethrows this save's own failure
      if (uploadRun) await uploadRun;

      setCurrentDraftID(draftId);
      return draftId;
    }
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

  const removeAttachmentMutation = createComposeOperation(
    services.removeAttachment
  );
  const removeForwardedAttachmentMutation = createComposeOperation(
    services.removeForwardedAttachment
  );

  const handleAddAttachments = (attachments: DraftFormAttachment[]) => {
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
      removeForwardedAttachmentMutation.start({
        draftID: savedDraftID,
        attachmentID: attachment.attachmentID,
        linkId: headerLinkId(),
      });
    } else {
      removeAttachmentMutation.start({
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
    if (threadId) services.prepareUndo(threadId, draftId);

    // Overwrite the server-side draft with the pre-send content. The
    // snapshot itself stays for the compose remount below to restore the
    // form from.
    const snapshot = composeUndo.peek(draftId);
    if (snapshot) {
      await services.restoreDraft(
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
    if (threadId) services.refreshAfterUndo(threadId);

    props.host?.showDraft?.(draftId);
  };

  // `linkId` is the X-Email-Link-Id header value the send itself used, resolved
  // at send time.
  const undoSend = (
    draftId: string,
    threadId: string | undefined,
    linkId: string | undefined
  ) =>
    services.undoSend({
      draftId,
      linkId,
      onUndone: () => restoreAfterUndoSend(draftId, threadId, linkId),
    });

  const sendMutation = createComposeOperation(services.sendMessage, {
    onSuccess: (data, vars) => {
      const draftId = data.message.db_id;
      const threadId = data.message.thread_db_id;
      // This send opens a fresh undo cycle for the draft id.
      if (draftId) endUndoSend(draftId);
      const sendLinkId = vars.linkId;
      const toastId = services.feedback.success('Email sent', {
        actions: draftId
          ? [
              {
                label: 'Undo',
                onClick: () => {
                  if (toastId != null) services.feedback.dismiss(toastId);
                  void undoSend(draftId, threadId ?? undefined, sendLinkId);
                },
              },
            ]
          : undefined,
        duration: 5_000,
      });
      if (data.message.thread_db_id) {
        props.host?.showThread?.(data.message.thread_db_id);
      }
    },
    onError: () => {
      services.feedback.failure('Failed to send email');
    },
  });

  const onSubmit = async () => {
    if (scheduling()) return;
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

    // Scheduling may have started while the draft save was pending.
    if (scheduling() || form.sendTime()) return;

    // Snapshot editor state before watermark so undo-send can restore it
    if (currentEditor) {
      const snapshotHtml = currentEditor.read(() =>
        $generateHtmlFromNodes(currentEditor)
      );
      const draftId = currentDraftID();
      if (draftId) {
        composeUndo.remember({
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

    sendMutation.start({
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

  const unscheduleMessageMutation = createComposeOperation(
    services.unschedule,
    {
      onSuccess: (_data, vars) => {
        services.feedback.success('Email unscheduled');
        services.invalidatePreview(vars.draftID);
      },
      onError: () => {
        services.feedback.failure('Failed to unschedule email');
      },
    }
  );

  const handleSendTimeChange = async (date: Date | null) => {
    if (scheduling()) return;
    setScheduling(true);
    try {
      const previous = form.sendTime();
      const currentDraft = currentDraftID();
      if (!date && previous && currentDraft) {
        try {
          await unscheduleMessageMutation.run({
            draftID: currentDraft,
            linkId: headerLinkId(),
          });
          form.setSendTime(null);
          setDraftDirty(true);
        } catch {
          /* The operation reports the failure; keep the confirmed send time. */
        }
        return;
      }
      if (!date) {
        form.setSendTime(null);
        setDraftDirty(true);
        return;
      }
      try {
        const draftID = currentDraft ?? (await executeSaveDraft());
        if (!draftID) throw new Error('Draft required');
        await services.schedule(
          { draftID, send_time: date.toISOString() },
          headerLinkId()
        );
        form.setSendTime(date);
        setDraftDirty(true);
      } catch (error) {
        services.reportError(error);
        services.feedback.failure('Failed to schedule message');
        return;
      }
      const threadID = saveDraftMutation.result()?.draft.thread_db_id;
      if (threadID) {
        try {
          await services.archive({ id: threadID, value: true }, headerLinkId());
        } catch (error) {
          services.reportError(error);
          services.feedback.failure(
            'Email scheduled, but unable to mark thread done'
          );
        }
      }
    } finally {
      setScheduling(false);
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
      await deleteDraftMutation.run({
        draftId,
        threadId: currentThreadID(),
        linkId: headerLinkId(),
      });
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
        recipientName = services.recipientName(recipients[0].data.id);
      }

      return recipientName ? `Email to ${recipientName}` : 'Draft email';
    }

    const names = recipients
      .slice(0, 2)
      .map((r) => {
        if (r.kind === 'user') {
          return services.recipientName(r.data.id);
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
    bodyActions: {
      focusSibling: props.host?.focusSibling,
      recipientAdded: (email) => {
        services.feedback.success(`${email} added to CC`);
      },
      readDroppedFiles: services.readDroppedFiles,
      pasteFiles: (editor, files, directories) =>
        services.uploadEditorFiles({
          editor,
          files,
          directories,
          onUploaded: (ids) => ids.forEach(services.makePublic),
        }),
    },
    isMobile: services.isMobile,
    scheduleEnabled: services.scheduleEnabled,
    attachmentFailure: services.feedback.failure,
    prepareSignatureLinks: services.prepareSignatureLinks,
    onUpgrade: services.onUpgrade,
    viewerLoading: services.viewerLoading,
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
    disabled: () => hasLinkError() || sendMutation.pending() || scheduling(),
    isSending: () => sendMutation.pending(),
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
    scheduleSendDisabled: () => totalRecipientCount() === 0 || scheduling(),

    // Display
    fromAddress: () => link()?.email_address,
    fromInboxes: () => services.accounts.inboxes() ?? [],
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
  };
  return {
    context: ctxValue,
    editor,
    previewName,
    hasLinkError,
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
