import { createContext, useContext } from 'solid-js';
import type {
  EmailComposeHost,
  EmailComposeServices,
} from '../../email-compose/context/compose-services';
import type { EmailAttachment } from '../../email-message/core/email-message';
import type { EmailThreadDependencies } from '../context/email-thread-dependencies';

export interface ThreadViewEnvironment {
  dependencies: EmailThreadDependencies;
  copySubject?: (subject: string) => void;
  compose: EmailComposeServices;
  composeHost?: EmailComposeHost;
  rendering: { openAttachment?: (attachment: EmailAttachment) => void };
}

const ThreadEnvironment = createContext<ThreadViewEnvironment>();
export const ThreadEnvironmentProvider = ThreadEnvironment.Provider;
export function useEmailThreadEnvironment() {
  const value = useContext(ThreadEnvironment);
  if (!value)
    throw new Error('Email thread views require a ThreadEnvironmentProvider');
  return value;
}
