import { type Accessor, createContext, type JSX, useContext } from 'solid-js';
import type {
  EmailComposeContext,
  EmailComposeHost,
} from '../../email-compose/context/compose-capabilities';
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

export interface EmailThreadViewContext {
  thread: EmailThreadContext;
  copySubject?: (subject: string) => void | boolean | Promise<void | boolean>;
  compose: EmailComposeContext;
  composeHost?: EmailComposeHost;
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
