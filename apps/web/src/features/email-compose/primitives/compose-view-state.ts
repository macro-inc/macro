import type { LexicalEditor } from 'lexical';
import type { Accessor, JSX } from 'solid-js';
import type { ComposeBodyActions } from '../context/editor-capabilities';
import type {
  EmailFormRecipients,
  EmailRecipient,
} from '../core/email-recipient';
import type { DraftFormAttachment } from './email-form-state';
import type { EmailScheduleState } from './email-send-schedule';

export type ComposeValidationError = {
  type: 'no_recipient' | 'no_message' | 'no_subject' | 'no_link';
  message: string;
};

export interface ComposeContextValue extends ComposeState {
  bodyActions: ComposeBodyActions;
  isMobile: Accessor<boolean>;
  scheduleEnabled: boolean;
  attachmentFailure(message: string, options?: { subtext?: string }): void;
  onUpgrade?: () => void;
  viewerLoading?: Accessor<boolean>;
}

export interface ComposeState {
  // Form state (read)
  recipients: () => EmailFormRecipients;
  subject: () => string;
  attachments: () => DraftFormAttachment[];
  initialHtml: () => string | undefined;
  initialMarkdown?: () => string | undefined;

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
  onEditorInitialized?: (editor: LexicalEditor) => void;

  // Actions
  onSend: () => void;
  onDelete?: () => void;
  schedule: {
    state: Accessor<EmailScheduleState>;
    selectedTime: Accessor<Date | undefined>;
    confirmedTime: Accessor<Date | undefined>;
    actionLabel: Accessor<string>;
    operation: Accessor<'idle' | 'committing' | 'updating' | 'cancelling'>;
    onSelect(date: Date | null): boolean;
    onCancel(): Promise<boolean>;
    pickerDisabled: Accessor<boolean>;
  };

  // Status
  disabled: Accessor<boolean>;
  primaryActionDisabled: Accessor<boolean>;
  isSending: Accessor<boolean>;
  isSavingDraft?: Accessor<boolean>;
  hasDraft: Accessor<boolean>;
  sendUnavailableReason?: Accessor<string | undefined>;
  deliveryState?: Accessor<'draft' | 'scheduled' | 'sent' | 'missing'>;

  // Validation
  validationError: (
    type: ComposeValidationError['type']
  ) => ComposeValidationError | undefined;

  // Recipients config
  recipientOptions: () => Array<EmailRecipient>;
  focusRecipientsOnMount: boolean;
  includeSelf?: boolean;
  hideAttachments?: boolean;

  // Display
  fromAddress?: Accessor<string | undefined>;
  // From-inbox selection: the inboxes the user can send from, the active one,
  // and a setter to change it.
  fromInboxes?: Accessor<
    {
      id: string;
      email_address: string;
      displayName?: string;
      photo_url?: string | null;
    }[]
  >;
  selectedInboxId?: Accessor<string | undefined>;
  onSelectInbox?: (inboxId: string) => void;
  hasPaidAccess: Accessor<boolean>;

  // Signature preview slot — rendered below the body. Provided by the new-email
  // composer and the AI chat composer (ChatCompose); the reply/forward input
  // renders its own preview and omits this slot.
  signaturePreview?: () => JSX.Element;
}
