import { createContext, useContext } from 'solid-js';
import type { EmailBodyShown } from './email-rendering-context';

/** Lets the surface that opened a thread wait for that thread's bodies. */
export interface EmailBodyOpenObserver {
  /** A body that will show HTML mounted; release it if it unmounts first. */
  pending(messageId: string): () => void;
  shown(shown: EmailBodyShown): void;
}

const EmailBodyOpenContext = createContext<EmailBodyOpenObserver>();
export const EmailBodyOpenProvider = EmailBodyOpenContext.Provider;
export const useEmailBodyOpenObserver = () => useContext(EmailBodyOpenContext);
