import { useEmail } from '@service-gql/client';
import type { LexicalEditor } from 'lexical';
import { createSignal, type Setter } from 'solid-js';
import { createStore } from 'solid-js/store';
import { decodeBase64Utf8 } from '../util/decodeBase64';
import { APPEND_PREVIOUS_EMAIL_COMMAND } from '../util/prepareEmailBody';
import {
  convertContactInfoToEmailRecipient,
  getReplyAllRecipients,
  getReplyRecipientsFromParent,
} from '../util/recipientConversion';
import type { ReplyType } from '../util/replyType';
import { getSubjectText } from '../util/subjectText';
import { type EmailRecipient, useEmailContext } from './EmailContext';

export type EmailFormRecipients = {
  to: EmailRecipient[];
  cc: EmailRecipient[];
  bcc: EmailRecipient[];
};

/**
 * Creates a state object for the email form.
 * @param key - The db_id of the email being replied to.
 * @returns A state object for the email form.
 */
export function createEmailFormState(key: string) {
  const emailCtx = useEmailContext();
  const userEmail = useEmail();

  const replyingTo = emailCtx.filteredMessages().find((m) => m.db_id === key);
  const draft = emailCtx.messageDbIdToDraftChildren[key];

  const draftContainsAppendedReply = () => {
    const encoded = draft?.body_html_sanitized;
    if (!encoded) return false;
    const decodedHtml = decodeBase64Utf8(encoded);
    if (!decodedHtml) return false;
    return (
      new DOMParser()
        .parseFromString(decodedHtml, 'text/html')
        .body.querySelector('div.macro_quote') !== null
    );
  };

  const [replyAppended, setReplyAppended] = createSignal<boolean>(
    draftContainsAppendedReply() ?? false
  );

  const [onDirtyCb, setOnDirtyCb] = createSignal<(() => void) | undefined>();
  const [onReplyTypeAppliedCb, setOnReplyTypeAppliedCb] = createSignal<
    ((rt: ReplyType | undefined) => void) | undefined
  >();
  const [capturedEditor, setCapturedEditor] = createSignal<LexicalEditor>();
  // We track the last reply type applied to replay against the current state when setOnReplyTypeApplied is attached
  const [lastReplyTypeApplied, setLastReplyTypeApplied] = createSignal<
    ReplyType | undefined
  >(undefined);

  const [replyType, setReplyTypeInner] = createSignal<ReplyType | undefined>(
    undefined
  );

  const [shouldFocusInput, setShouldFocusInput] = createSignal(false);

  const initialReplyType: ReplyType | undefined = replyingTo
    ? (replyingTo.to.length ?? 0) + (replyingTo.cc.length ?? 0) > 1
      ? 'reply-all'
      : 'reply'
    : undefined;

  const initialRecipients: EmailFormRecipients = draft
    ? {
        to: draft.to.map(convertContactInfoToEmailRecipient) ?? [],
        cc: draft.cc.map(convertContactInfoToEmailRecipient) ?? [],
        bcc: draft.bcc.map(convertContactInfoToEmailRecipient) ?? [],
      }
    : replyingTo && initialReplyType
      ? initialReplyType === 'reply-all'
        ? getReplyAllRecipients(replyingTo, userEmail() ?? '')
        : getReplyRecipientsFromParent(replyingTo, userEmail() ?? '')
      : { to: [], cc: [], bcc: [] };

  const [recipients, setRecipientsInner] = createStore<EmailFormRecipients>({
    to: initialRecipients.to,
    cc: initialRecipients.cc,
    bcc: initialRecipients.bcc,
  });

  // A wrapper around setRecipientsInner that runs the side-effects alongside setting the store
  const setRecipients = (
    field: keyof EmailFormRecipients,
    value: EmailRecipient[] | ((prev: EmailRecipient[]) => EmailRecipient[])
  ) => {
    const next = typeof value === 'function' ? value(recipients[field]) : value;
    setRecipientsInner(field, next);
    callDirty();
    const all = [...recipients.to, ...recipients.cc, ...recipients.bcc];
    emailCtx.onRecipientsAugment(all);
  };

  const initialSubject =
    draft?.subject ??
    getSubjectText(
      replyingTo,
      (replyingTo?.to.length ?? 0) + (replyingTo?.cc.length ?? 0) > 1
        ? 'reply-all'
        : 'reply'
    ) ??
    '';

  const [subject, setSubjectInner] = createSignal<string>(initialSubject);

  const setSubject: Setter<string> = (value) => {
    const result = setSubjectInner(value);
    callDirty();
    return result;
  };

  // A wrapper around setReplyTypeInner that runs the side-effects alongside setting the signal
  type ReplySetter = typeof setReplyTypeInner;
  const setReplyType = (...args: Parameters<ReplySetter>) => {
    const rt = setReplyTypeInner(...args);
    const msg = replyingTo;
    if (msg) {
      const calculated =
        rt === 'reply-all'
          ? getReplyAllRecipients(msg, userEmail() ?? '')
          : rt === 'reply'
            ? getReplyRecipientsFromParent(msg, userEmail() ?? '')
            : { to: [], cc: [], bcc: [] };

      setRecipients('to', calculated.to ?? []);
      setRecipients('cc', calculated.cc ?? []);
      setRecipients('bcc', calculated.bcc ?? []);

      if (rt) {
        setSubject(getSubjectText(msg, rt));

        if (rt === 'forward') {
          setReplyAppended(true);
          capturedEditor()?.dispatchCommand(APPEND_PREVIOUS_EMAIL_COMMAND, {
            replyingTo: replyingTo,
            replyType: rt,
          });
        }
      }
    }

    callDirty();
    setLastReplyTypeApplied(rt);
    onReplyTypeAppliedCb()?.(rt);
    return rt;
  };

  const callDirty = () => {
    onDirtyCb()?.();
  };

  const reset = () => {
    setReplyAppended(draftContainsAppendedReply() ?? false);

    // Restore reply type first without side effects that recalc recipients
    setReplyTypeInner(initialReplyType);
    setLastReplyTypeApplied(initialReplyType);

    // Restore recipients to their initial values (draft or computed)
    setRecipientsInner('to', initialRecipients.to);
    setRecipientsInner('cc', initialRecipients.cc);
    setRecipientsInner('bcc', initialRecipients.bcc);

    // Notify context of the full recipient list after reset
    const all = [
      ...initialRecipients.to,
      ...initialRecipients.cc,
      ...initialRecipients.bcc,
    ];
    emailCtx.onRecipientsAugment(all);

    // Restore subject and input focus
    setSubjectInner(initialSubject);
    setShouldFocusInput(false);

    // Mark as dirty to propagate change
    callDirty();
  };

  const value = {
    draft,
    replyAppended,
    setReplyAppended,
    recipients,
    setRecipients,
    subject,
    setSubject,
    replyType,
    setReplyType,
    shouldFocusInput,
    setShouldFocusInput,
    reset,
    setOnDirty: (cb?: () => void) => {
      setOnDirtyCb(() => cb);
    },
    setOnReplyTypeApplied: (cb?: (rt: ReplyType | undefined) => void) => {
      setOnReplyTypeAppliedCb(() => cb);
      const rt = lastReplyTypeApplied() ?? replyType();
      if (cb && rt !== undefined) queueMicrotask(() => cb(rt));
    },
    setCapturedEditor: (editor: LexicalEditor) => {
      setCapturedEditor(editor);
    },
  };

  return value;
}
