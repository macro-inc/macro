import { createContext, useContext } from 'solid-js';
import type { EmailThreadState } from '../primitives/email-thread-state';

const EmailThreadStateContext = createContext<EmailThreadState>();
export const EmailThreadStateProvider = EmailThreadStateContext.Provider;
export function useEmailThreadState() {
  const ctx = useContext(EmailThreadStateContext);
  if (!ctx)
    throw new Error(
      'useEmailThreadState must be used within an EmailThreadStateProvider'
    );
  return ctx;
}
