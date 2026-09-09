import type { Accessor } from 'solid-js';
import type { EmailRecipient } from '../core/email-recipient';
import type { ReplyType } from '../core/reply-type';

export interface EmailFormContextInputs {
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
  isPersonalReply: Accessor<boolean>;
  onDraftRemoved(): void;
  exitToThread(target: 'last' | 'selected'): boolean;
  replyRequest: {
    replyType: Accessor<ReplyType | undefined>;
    clear(): void;
  };
  getMarkDoneNavigationTargetId(): string | undefined;
}
