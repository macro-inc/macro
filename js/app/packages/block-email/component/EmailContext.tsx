import type { WithCustomUserInput } from '@core/user';
import type {
  MessageWithBodyReplyless,
  Thread,
} from '@service-email/generated/schemas';
import {
  type Accessor,
  createContext,
  type Setter,
  useContext,
} from 'solid-js';
import type { SetStoreFunction } from 'solid-js/store';
import type { createThreadMessagesResource } from '../signal/threadMessages';

export type EmailRecipient = WithCustomUserInput<'user' | 'contact'>;

export type EmailContextValue = {
  recipientOptions: Accessor<EmailRecipient[]>;
  onRecipientsAugment: (items: EmailRecipient[]) => void;
  messageDbIdToDraftChildren: Record<string, MessageWithBodyReplyless>;
  setMessageDbIdToDraftChildren: SetStoreFunction<
    Record<string, MessageWithBodyReplyless>
  >;
  messagesRef: Accessor<HTMLDivElement | undefined>;
  setMessagesRef: Setter<HTMLDivElement | undefined>;
  threadMessagesResource: Accessor<ReturnType<
    typeof createThreadMessagesResource
  > | null>;
  focusedMessageId: Accessor<string | undefined>;
  setFocusedMessageId: Setter<string | undefined>;
  filteredMessages: Accessor<MessageWithBodyReplyless[]>;
  threadData: Accessor<Thread | undefined>;
  archiveThread: () => boolean;
};

const EmailContext = createContext<EmailContextValue>();

export function EmailProvider(props: {
  value: EmailContextValue;
  children: any;
}) {
  return (
    <EmailContext.Provider value={props.value}>
      {props.children}
    </EmailContext.Provider>
  );
}

export function useEmailContext(): EmailContextValue {
  const ctx = useContext(EmailContext);
  if (!ctx) {
    throw new Error('useEmailContext must be used within an EmailProvider');
  }
  return ctx;
}
