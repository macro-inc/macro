import type { EmailMessage } from './core/email-message';
import { createMessageOperationSource } from './queries/message-operation';
import { MessageOperationRecovery } from './views/message-operation-recovery';

/** Production wiring for a message's recovery controls. */
export function EmailMessageOperation(props: { message: EmailMessage }) {
  const source = createMessageOperationSource(
    () => props.message.db_id,
    () => props.message.thread_db_id
  );
  return <MessageOperationRecovery source={source} />;
}
