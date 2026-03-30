import type { DraftFormAttachment } from '@block-email/component/createEmailFormState';
import type { EmailRecipient } from '@block-email/component/EmailContext';
import type { LexicalEditor } from 'lexical';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';

export type EmailFormRecipients = {
  to: EmailRecipient[];
  cc: EmailRecipient[];
  bcc: EmailRecipient[];
};

export type RecipientFieldId = 'to' | 'cc' | 'bcc';

export type ComposeValidationError = {
  type: 'no_recipient' | 'no_message' | 'no_subject' | 'no_link';
  message: string;
};

export interface ComposeContextValue {
  // Form state (read)
  recipients: () => EmailFormRecipients;
  subject: () => string;
  attachments: () => DraftFormAttachment[];
  sendTime: () => Date | null | undefined;
  initialHtml: () => string | undefined;

  // Form state (write)
  setRecipients: (
    field: keyof EmailFormRecipients,
    value: EmailRecipient[]
  ) => void;
  setSubject: (value: string) => void;
  onContentChange: (content: string) => void;
  onAddAttachments: (attachments: DraftFormAttachment[]) => void;
  onRemoveAttachment: (attachment: DraftFormAttachment) => void;

  // Editor
  captureEditor: (editor: LexicalEditor) => void;

  // Actions
  onSend: () => void;
  onDelete?: () => void;
  onSendTimeChange?: (date: Date | null) => void;

  // Status
  disabled: Accessor<boolean>;
  isSending: Accessor<boolean>;
  isDraftSaving: Accessor<boolean>;
  hasDraft: Accessor<boolean>;

  // Validation
  validationError: (
    type: ComposeValidationError['type']
  ) => ComposeValidationError | undefined;

  // Recipients config
  recipientOptions: () => Array<EmailRecipient>;
  focusRecipientsOnMount: boolean;

  // Schedule send
  scheduleSendDisabled?: Accessor<boolean>;

  // Display
  fromAddress?: Accessor<string | undefined>;
  hasPaidAccess: Accessor<boolean>;

  // Toolbar slot — allows orchestrators to provide a custom toolbar
  toolbar?: () => JSX.Element;
}

const ComposeContext = createContext<ComposeContextValue>();

export const ComposeProvider = ComposeContext.Provider;

export function useCompose(): ComposeContextValue {
  const ctx = useContext(ComposeContext);
  if (!ctx) {
    throw new Error('useCompose must be used within a ComposeProvider');
  }
  return ctx;
}
