import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import type {
  EmailComposeContext,
  EmailComposeHost,
} from '../../email-compose/context/compose-capabilities';
import type { ReplyType } from '../../email-compose/core/reply-type';
import type { CalendarInvitation } from '../../email-message/core/calendar-invitation';
import type {
  EmailAttachment,
  EmailMessage,
} from '../../email-message/core/email-message';
import type { InvitationRenderOptions } from '../../email-message/views/email-message';
import type { EmailThreadContext } from './email-thread-context';

export interface EmailThreadOrganizationStatus {
  /** True when the user, not the opening of the thread, asked for its mark-as-read. */
  announceRead: Accessor<boolean>;
}

/** A reply, by its thread and the message it answers. */
export type EmailReplyTarget = { threadId: string; messageId: string };

/** A reply on its way between its thread and the reply window. */
export type EmailReplyHandoff = EmailReplyTarget & { replyType: ReplyType };

/**
 * The app's reply window. A reply popped out of its thread floats over the
 * whole app and stays open while the user moves around; the thread shows a
 * notice in its place. Both sides load the reply from its saved draft, so
 * only one editor ever holds it.
 */
export interface EmailReplyWindow {
  holds(target: EmailReplyTarget): boolean;
  /** Opens a saved reply in the window, replacing any reply already there. */
  open(reply: EmailReplyHandoff): void;
  /** Shows the window and puts the cursor in its reply. */
  focus(): void;
  /** The reply the window last gave back; its thread opens it inline. */
  returned: Accessor<EmailReplyHandoff | undefined>;
  clearReturned(): void;
  /** The window's reply was last sent or discarded; threads drop its draft. */
  removed: Accessor<EmailReplyTarget | undefined>;
}

export interface EmailThreadViewContext {
  thread: EmailThreadContext;
  copySubject?: (subject: string) => void | boolean | Promise<void | boolean>;
  compose: EmailComposeContext;
  composeHost?: EmailComposeHost;
  /** Absent where replies can't leave the thread (touch, tests, embeds). */
  replyWindow?: EmailReplyWindow;
  rendering: {
    renderTags?: () => JSX.Element;
    renderOrganizationStatus?: (
      status: EmailThreadOrganizationStatus
    ) => JSX.Element;
    renderInvitation?: (
      message: EmailMessage,
      invitation: CalendarInvitation,
      options?: InvitationRenderOptions
    ) => JSX.Element;
    renderOperation?: (message: EmailMessage) => JSX.Element;
    renderAvatar?: (message: EmailMessage) => JSX.Element;
    openAttachment?: (attachment: EmailAttachment) => void;
    downloadAttachment?: (attachment: EmailAttachment) => void;
  };
}

const ThreadViewContext = createContext<EmailThreadViewContext>();
export const EmailThreadViewProvider = ThreadViewContext.Provider;
export function useEmailThreadViewContext() {
  const value = useContext(ThreadViewContext);
  if (!value)
    throw new Error('Email thread views require an EmailThreadViewProvider');
  return value;
}
