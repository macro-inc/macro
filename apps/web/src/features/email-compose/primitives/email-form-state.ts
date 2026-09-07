import type { EmailFormRecipients } from '../core/email-recipient';

export type {
  EmailFormRecipients,
  RecipientFieldId,
} from '../core/email-recipient';

import type { EmailRecipient } from '@app/features/email-compose/core/email-recipient';
import type { EmailMessage } from '@app/features/email-message/core/email-message';
import { createSignal, type Setter } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import type { EmailFormDependencies } from '../context/email-form-dependencies';
import { decodeBase64Utf8 } from '../core/decode-base64';
import {
  convertContactInfoToEmailRecipient,
  getReplyAllRecipients,
  getReplyRecipientsFromParent,
} from '../core/recipient-conversion';
import type { ReplyType } from '../core/reply-type';
import { getSubjectText } from '../core/subject-text';

export type DraftFormAttachment =
  | {
      type: 'local';
      file: File;
      attachmentID?: string;
    }
  | {
      type: 'remote';
      url: string;
      fileName: string;
      contentType: string;
      attachmentID: string;
      fileSize: number;
    }
  | {
      type: 'forwarded';
      attachmentID: string;
      fileName: string;
      mimeType: string;
      fileSize: number;
    };

export interface EmailFormStateOptions {
  getMessageByID: (id: string) => EmailMessage | undefined;
  getDraftForMessageReply: (id: string) => EmailMessage | undefined;
  onRecipientsChange?: (next: EmailRecipient[]) => void;
}

type EmailFormState = {
  recipients: {
    to: EmailRecipient[];
    cc: EmailRecipient[];
    bcc: EmailRecipient[];
  };
  replyType: ReplyType;
  withQuotedText: boolean;
  subject: string;
  markdownBody: string;
  sendTime?: Date;
};

const EMPTY_FORM_STATE: EmailFormState = {
  recipients: {
    to: [],
    cc: [],
    bcc: [],
  },
  replyType: 'reply-all',
  withQuotedText: false,
  subject: '',
  markdownBody: '',
};

/**
 * Creates a state object for the email form.
 * @param purpose - The purpose of the form. Are we managing the state of a draft reply or just a draft message
 * @param options - Required options for the initial state to be calculated from
 * @returns A state object for the email form.
 */
export function createEmailFormState(
  dependencies: EmailFormDependencies,
  purpose?:
    | { type: 'replying_to'; messageID: string }
    | { type: 'draft'; messageID: string },

  options?: EmailFormStateOptions
) {
  const userEmail = dependencies.viewerEmail;

  let replyingTo: EmailMessage | undefined;

  if (purpose?.type === 'replying_to') {
    replyingTo = options?.getMessageByID?.(purpose.messageID);
  }

  let draft: EmailMessage | undefined;

  if (purpose?.type === 'draft') {
    draft = options?.getMessageByID(purpose.messageID);
  } else if (purpose?.type === 'replying_to') {
    draft = options?.getDraftForMessageReply(purpose?.messageID);
  }

  // The inbox this compose sends from. Defaults to the inbox that owns the
  // thread/draft; the user can change it via the "from" selector.
  const [selectedLinkId, setSelectedLinkId] = createSignal<string | undefined>(
    (draft ?? replyingTo)?.link_id ?? undefined
  );
  // Reply logic ("did I send this?") must be judged against the inbox the
  // message is sent from, not the account's primary email — otherwise replying
  // from a secondary or delegated inbox misclassifies the sender and picks the
  // wrong recipients.
  const inboxEmail = () => {
    const linkId = selectedLinkId() ?? (draft ?? replyingTo)?.link_id;
    const ownerEmail = linkId
      ? dependencies.inboxes().find((l) => l.id === linkId)?.email_address
      : undefined;
    return ownerEmail ?? userEmail() ?? '';
  };

  const draftContainsAppendedReply = () => {
    const encoded = draft?.body_html_sanitized;
    if (!encoded) return false;
    const decodedHtml = decodeBase64Utf8(encoded);
    if (!decodedHtml) return false;
    const parsed = new DOMParser().parseFromString(decodedHtml, 'text/html');

    return parsed.body.querySelector('div.macro_quote') !== null;
  };

  const getInitialState = () => {
    const replyType =
      (replyingTo?.to.length ?? 0) + (replyingTo?.cc.length ?? 0) > 1
        ? 'reply-all'
        : 'reply';

    let initialSubject = draft?.subject;

    if (initialSubject == null) {
      initialSubject = getSubjectText(replyingTo, replyType);
    }

    let initialRecipients: EmailFormRecipients = { to: [], cc: [], bcc: [] };

    if (draft) {
      initialRecipients = {
        to: draft.to.map(convertContactInfoToEmailRecipient) ?? [],
        cc: draft.cc.map(convertContactInfoToEmailRecipient) ?? [],
        bcc: draft.bcc.map(convertContactInfoToEmailRecipient) ?? [],
      };
    } else if (replyingTo) {
      initialRecipients =
        replyType === 'reply-all'
          ? getReplyAllRecipients(replyingTo, inboxEmail())
          : getReplyRecipientsFromParent(replyingTo, inboxEmail());
    }

    return {
      recipients: initialRecipients,
      replyType,
      withQuotedText: draftContainsAppendedReply(),
      subject: initialSubject,
      markdownBody: '',
      sendTime: draft?.scheduled_send_time
        ? new Date(draft.scheduled_send_time)
        : undefined,
    } satisfies EmailFormState;
  };

  const [state, setState] = createStore<EmailFormState>({
    ...getInitialState(),
  });

  // Values and edit revisions may outlive a mounted composer; effects do not.
  const [editRevision, setEditRevision] = createSignal(0);

  // TODO: Replace this signal with a memo deriving the attachments from the draft data
  // and a temporary queue to track attachments to be uploaded on draft save
  const [attachments, setAttachments] = createSignal<DraftFormAttachment[]>([
    ...(draft?.attachments_draft.map((a) => ({
      type: 'remote' as const,
      attachmentID: a.id,
      contentType: a.content_type,
      fileName: a.file_name,
      url: a.s3_key,
      fileSize: a.size,
    })) ?? []),
    ...(draft?.attachments_forwarded.map((a) => ({
      type: 'forwarded' as const,
      attachmentID: a.attachment_id,
      fileName: a.filename ?? 'attachment',
      mimeType: a.mime_type ?? 'application/octet-stream',
      fileSize: a.size_bytes ?? 0,
    })) ?? []),
  ]);

  const setRecipients = (
    field: keyof EmailFormRecipients,
    value: EmailRecipient[]
  ) => {
    setState('recipients', field, value);
    callDirty();
    const recipients = state.recipients;
    const all = [...recipients.to, ...recipients.cc, ...recipients.bcc];
    options?.onRecipientsChange?.(unwrap(all));
  };

  const setSubject: Setter<string> = (value) => {
    const result = setState('subject', value);
    callDirty();
    return result;
  };

  const setReplyType = (next: ReplyType) => {
    setState('replyType', next);
    const rt = state.replyType;
    const msg = replyingTo;

    // Clear forwarded attachments when switching away from forward
    setAttachments((prev) => prev.filter((a) => a.type !== 'forwarded'));

    if (msg) {
      let calculated: EmailFormRecipients = { to: [], cc: [], bcc: [] };

      switch (rt) {
        case 'reply-all': {
          calculated = getReplyAllRecipients(msg, inboxEmail());
          break;
        }
        case 'reply': {
          calculated = getReplyRecipientsFromParent(msg, inboxEmail());
        }
      }

      setRecipients('to', calculated.to ?? []);
      setRecipients('cc', calculated.cc ?? []);
      setRecipients('bcc', calculated.bcc ?? []);

      setSubject(getSubjectText(msg, rt));

      if (rt === 'forward') {
        setState('withQuotedText', true);
        // Populate forwarded attachments from original message (skip inline images)
        const fwdAttachments: DraftFormAttachment[] = (msg.attachments ?? [])
          .filter((a) => !a.content_id)
          .map((a) => ({
            type: 'forwarded' as const,
            attachmentID: a.db_id,
            fileName: a.filename ?? 'attachment',
            mimeType: a.mime_type ?? 'application/octet-stream',
            fileSize: a.size_bytes ?? 0,
          }));
        setAttachments((prev) => [...prev, ...fwdAttachments]);
      }
    }

    callDirty();
    return rt;
  };

  // Change the inbox this compose sends from. For an active reply, re-derive the
  // recipients against the newly selected inbox (the sender comparison changes).
  const setSelectedFromLink = (linkId: string | undefined) => {
    setSelectedLinkId(linkId);
    if (!replyingTo || draft || state.replyType === 'forward') return;
    const recalculated =
      state.replyType === 'reply-all'
        ? getReplyAllRecipients(replyingTo, inboxEmail())
        : getReplyRecipientsFromParent(replyingTo, inboxEmail());
    setRecipients('to', recalculated.to ?? []);
    setRecipients('cc', recalculated.cc ?? []);
    setRecipients('bcc', recalculated.bcc ?? []);
  };

  const setSendTime = (date: Date | null) => {
    setState('sendTime', date ?? undefined);
  };

  const callDirty = () => {
    setEditRevision((revision) => revision + 1);
  };

  const reset = () => {
    setState(reconcile({ ...getInitialState() }));
    const recipients = state.recipients;

    // Notify context of the full recipient list after reset
    const all = [...recipients.to, ...recipients.cc, ...recipients.bcc];
    options?.onRecipientsChange?.(unwrap(all));

    setAttachments([]);
  };

  const clear = () => {
    setState(reconcile({ ...EMPTY_FORM_STATE }));
    const recipients = state.recipients;

    // Notify context of the full recipient list after reset
    const all = [...recipients.to, ...recipients.cc, ...recipients.bcc];
    options?.onRecipientsChange?.(unwrap(all));

    setAttachments([]);
  };

  const value = {
    draft,
    replyAppended: () => state.withQuotedText,
    setReplyAppended: (next: boolean) => setState('withQuotedText', next),
    recipients: () => state.recipients,
    setRecipients,
    subject: () => state.subject,
    setSubject,
    replyType: () => state.replyType,
    setReplyType,
    selectedLinkId: () => selectedLinkId(),
    setSelectedFromLink,
    editRevision,
    sendTime: () => state.sendTime,
    setSendTime,
    reset,
    clear,
    attachments: {
      list: attachments,
      add: (attachment: DraftFormAttachment) => {
        setAttachments((p) => [...p, attachment]);
      },
      assignAttachmentID: (file: File, attachmentID: string) => {
        setAttachments((p) =>
          p.map((a) =>
            a.type === 'local' && a.file === file ? { ...a, attachmentID } : a
          )
        );
      },
      clearAttachmentID: (file: File) => {
        setAttachments((p) =>
          p.map((a) =>
            a.type === 'local' && a.file === file
              ? { ...a, attachmentID: undefined }
              : a
          )
        );
      },
      removeByFile: (file: File) => {
        setAttachments((p) =>
          p.filter((a) => a.type !== 'local' || a.file !== file)
        );
      },
      removeByID: (attachmentID: string) => {
        setAttachments((p) =>
          p.filter(
            (a) => a.type !== 'remote' || a.attachmentID !== attachmentID
          )
        );
      },
      removeForwarded: (attachmentID: string) => {
        setAttachments((p) =>
          p.filter(
            (a) => a.type !== 'forwarded' || a.attachmentID !== attachmentID
          )
        );
      },
    },
  };

  return value;
}
