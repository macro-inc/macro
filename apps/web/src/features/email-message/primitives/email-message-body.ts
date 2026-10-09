import type { Accessor } from 'solid-js';
import type { EmailMessage } from '../core/email-message';

export { createStableEmailMessageBody as createEmailMessageBody } from './stable-email-message-body';

export interface EmailMessageBodyProps {
  message: EmailMessage;
  isPersonal: boolean;
  isBodyExpanded: Accessor<boolean>;
  setExpandedMessageBody: (id: string) => void;
  setFocusedMessageId: (messageId: string | undefined) => void;
  showFullContent?: boolean;
  isFocused: boolean;
}
