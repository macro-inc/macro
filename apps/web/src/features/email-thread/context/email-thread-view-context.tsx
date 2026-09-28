import { createContext, type JSX, useContext } from 'solid-js';
import type {
  EmailComposeContext,
  EmailComposeHost,
} from '../../email-compose/context/compose-capabilities';
import type { CalendarInvitation } from '../../email-message/core/calendar-invitation';
import type {
  EmailAttachment,
  EmailMessage,
} from '../../email-message/core/email-message';
import type { EmailThreadContext } from './email-thread-context';

export interface EmailThreadViewContext {
  thread: EmailThreadContext;
  copySubject?: (subject: string) => void;
  compose: EmailComposeContext;
  composeHost?: EmailComposeHost;
  rendering: {
    renderInvitation?: (
      message: EmailMessage,
      invitation: CalendarInvitation
    ) => JSX.Element;
    renderAvatar?: (message: EmailMessage) => JSX.Element;
    openAttachment?: (attachment: EmailAttachment) => void;
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
