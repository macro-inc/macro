import type { Accessor } from 'solid-js';
import type { EmailMessage } from '../../email-message/core/email-message';
import type { EmailRecipient } from '../core/email-recipient';
import type { ReplyType } from '../core/reply-type';

export interface EmailFormDependencies {
  viewerEmail: Accessor<string | undefined>;
  inboxes: Accessor<{ id: string; email_address: string }[]>;
}

/** Only the reply capabilities consumed by the composer; the caller owns navigation. */
export interface EmailReplySession {
  thread: Accessor<
    | {
        db_id: string;
        link_id: string;
        inbox_visible: boolean;
        provider_id?: string | null;
      }
    | undefined
  >;
  recipientOptions: Accessor<EmailRecipient[]>;
  onRecipientsChange(items: EmailRecipient[]): void;
  drafts: {
    getDraftForMessage(id: string): EmailMessage | undefined;
    deleteDraftForMessage(id: string): void;
  };
  messages: {
    list: Accessor<EmailMessage[]>;
    unfiltered: Accessor<EmailMessage[]>;
    personalSenders: Accessor<Set<string>>;
    focusedID: Accessor<string | undefined>;
    setFocused(id: string | undefined): void;
  };
  replyRequest: {
    messageId: Accessor<string | undefined>;
    replyType: Accessor<ReplyType | undefined>;
    clear(): void;
  };
  getMarkDoneNavigationTargetId(): string | undefined;
}
