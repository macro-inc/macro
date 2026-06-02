import { useEmail } from '@core/context/user';
import { useEmailLinksQuery } from '@queries/email/link';
import type { ApiMessage } from '@service-email/generated/schemas';
import type { LexicalEditor } from 'lexical';
import { createSignal, type Setter } from 'solid-js';
import { createStore, reconcile, unwrap } from 'solid-js/store';
import { decodeBase64Utf8 } from '../util/decodeBase64';
import { TOGGLE_APPEND_EMAIL_THREAD_COMMAND } from '../util/prepareEmailBody';
import {
  convertContactInfoToEmailRecipient,
  getReplyAllRecipients,
  getReplyRecipientsFromParent,
} from '../util/recipientConversion';
import type { ReplyType } from '../util/replyType';
import { getSubjectText } from '../util/subjectText';
import type { EmailRecipient } from './EmailContext';

export type EmailFormRecipients = {
  to: EmailRecipient[];
  cc: EmailRecipient[];
  bcc: EmailRecipient[];
};

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
  getMessageByID: (id: string) => ApiMessage | undefined;
  getDraftForMessageReply: (id: string) => ApiMessage | undefined;
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
  replyType: 'reply',
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
  purpose?:
    | { type: 'replying_to'; messageID: string }
    | { type: 'draft'; messageID: string },

  options?: EmailFormStateOptions
) {
  const userEmail = useEmail();

  let replyingTo: ApiMessage | undefined;

  if (purpose?.type === 'replying_to') {
    replyingTo = options?.getMessageByID?.(purpose.messageID);
  }

  let draft: ApiMessage | undefined;

  if (purpose?.type === 'draft') {
    draft = options?.getMessageByID(purpose.messageID);
  } else if (purpose?.type === 'replying_to') {
    draft = options?.getDraftForMessageReply(purpose?.messageID);
  }

  const linksQuery = useEmailLinksQuery();
  // Reply logic ("did I send this?") must be judged against the inbox that owns
  // the thread, not the account's primary email — otherwise replying within a
  // secondary or delegated inbox misclassifies the sender and picks the wrong
  // recipients.
  const inboxEmail = () => {
    const linkId = (draft ?? replyingTo)?.link_id;
    const ownerEmail = linkId
      ? linksQuery.data?.links.find((l) => l.id === linkId)?.email_address
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

  const [onDirtyCb, setOnDirtyCb] = createSignal<(() => void) | undefined>();

  const [onReplyTypeAppliedCb, setOnReplyTypeAppliedCb] = createSignal<
    ((rt: ReplyType | undefined) => void) | undefined
  >();

  const [capturedEditor, setCapturedEditor] = createSignal<LexicalEditor>();
  // If setReplyType('forward') is called before the Lexical editor mounts
  // (e.g. user clicks Forward while the bottom reply input is collapsed),
  // we stash the dispatch and replay it once the editor is captured.
  let pendingForwardAppend = false;

  // We track the last reply type applied to replay against the current state when setOnReplyTypeApplied is attached
  const [lastReplyTypeApplied, setLastReplyTypeApplied] = createSignal<
    ReplyType | undefined
  >(undefined);

  const [shouldFocusInput, setShouldFocusInput] = createSignal(false);

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
        const editor = capturedEditor();
        if (editor) {
          editor.dispatchCommand(TOGGLE_APPEND_EMAIL_THREAD_COMMAND, {
            replyingTo: replyingTo,
            replyType: rt,
            visible: true,
          });
        } else {
          pendingForwardAppend = true;
        }

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
    setLastReplyTypeApplied(rt);
    onReplyTypeAppliedCb()?.(rt);
    return rt;
  };

  const setSendTime = (date: Date | null) => {
    setState('sendTime', date ?? undefined);
  };

  const callDirty = () => {
    onDirtyCb()?.();
  };

  const reset = () => {
    setState(reconcile({ ...getInitialState() }));
    const recipients = state.recipients;

    // Notify context of the full recipient list after reset
    const all = [...recipients.to, ...recipients.cc, ...recipients.bcc];
    options?.onRecipientsChange?.(unwrap(all));

    setShouldFocusInput(false);

    setAttachments([]);

    // Mark as dirty to propagate change
    callDirty();
  };

  const clear = () => {
    setState(reconcile({ ...EMPTY_FORM_STATE }));
    const recipients = state.recipients;

    // Notify context of the full recipient list after reset
    const all = [...recipients.to, ...recipients.cc, ...recipients.bcc];
    options?.onRecipientsChange?.(unwrap(all));

    setShouldFocusInput(false);

    setAttachments([]);

    // Mark as dirty to propagate change
    callDirty();
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
    shouldFocusInput,
    setShouldFocusInput,
    sendTime: () => state.sendTime,
    setSendTime,
    reset,
    clear,
    setOnDirty: (cb?: () => void) => {
      setOnDirtyCb(() => cb);
    },
    setOnReplyTypeApplied: (cb?: (rt: ReplyType | undefined) => void) => {
      setOnReplyTypeAppliedCb(() => cb);
      const rt = lastReplyTypeApplied() ?? state.replyType;
      if (cb && rt !== undefined) queueMicrotask(() => cb(rt));
    },
    setCapturedEditor: (editor: LexicalEditor) => {
      setCapturedEditor(editor);
      if (pendingForwardAppend && replyingTo) {
        pendingForwardAppend = false;
        // Defer past the current Solid batch / microtask queue so that
        // registerToggleAppendedThread (registered via lazyRegister, which
        // uses createEffect) has actually attached the command handler
        // before we dispatch. queueMicrotask runs too early.
        setTimeout(() => {
          editor.dispatchCommand(TOGGLE_APPEND_EMAIL_THREAD_COMMAND, {
            replyingTo,
            replyType: 'forward',
            visible: true,
          });
        }, 0);
      }
    },
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
