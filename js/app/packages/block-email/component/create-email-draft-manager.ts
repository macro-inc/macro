import type { EmailRecipient } from '@block-email/component/EmailContext';
import type { ReplyType } from '@block-email/util/replyType';
import { createSignal, untrack } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

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
};

type EmailFormOptions = {
  initialState?: Partial<EmailFormState>;
  onMarkDirty?: VoidFunction;
  onReplyTypeChange?: (replyType: ReplyType) => void;
  onRecipientsChange?: (recipients: EmailRecipient[]) => void;
};

export const createEmailFormState = (opts?: EmailFormOptions) => {
  const initialState: EmailFormState = {
    recipients: {
      to: opts?.initialState?.recipients?.to ?? [],
      cc: opts?.initialState?.recipients?.cc ?? [],
      bcc: opts?.initialState?.recipients?.bcc ?? [],
    },
    replyType: opts?.initialState?.replyType ?? 'reply',
    subject: opts?.initialState?.subject ?? '',
    markdownBody: opts?.initialState?.markdownBody ?? '',
    withQuotedText: opts?.initialState?.withQuotedText ?? false,
  };

  const [isDirty, setIsDirty] = createSignal(false);

  const markDirty = () => {
    if (untrack(isDirty)) return;
    setIsDirty(true);
    opts?.onMarkDirty?.();
  };

  const [state, setState] = createStore<EmailFormState>({ ...initialState });

  const onRelyTypeChange = (next: ReplyType) => {
    setState('replyType', next);
    opts?.onReplyTypeChange?.(next);
    markDirty();
  };

  const onRecipientsChange = (
    type: 'to' | 'cc' | 'bcc',
    recipients: EmailRecipient[]
  ) => {
    setState('recipients', type, recipients);
    opts?.onRecipientsChange?.([
      ...state.recipients.to,
      ...state.recipients.cc,
      ...state.recipients.bcc,
    ]);
    markDirty();
  };

  const onSubjectChange = (next: string) => {
    setState('subject', next);
    markDirty();
  };

  const toggleWithQuotedText = () => {
    setState('withQuotedText', (p) => !p);
    markDirty();
  };

  const reset = () => {
    setState(reconcile({ ...initialState }));

    opts?.onRecipientsChange?.([
      ...state.recipients.to,
      ...state.recipients.cc,
      ...state.recipients.bcc,
    ]);
    setIsDirty(false);
  };

  return {
    state: () => state,
    reset,
    isDirty,
    onRelyTypeChange,
    onRecipientsChange,
    onSubjectChange,
    toggleWithQuotedText,
  };
};
