import { createContext, useContext } from 'solid-js';
import type { EmailThreadState } from '../primitives/email-thread-state';

const EmailContext = createContext<EmailThreadState>();
export const EmailProvider = EmailContext.Provider;
export function useEmailContext() {
  const ctx = useContext(EmailContext);
  if (!ctx)
    throw new Error('useEmailContext must be used within an EmailProvider');
  return ctx;
}
