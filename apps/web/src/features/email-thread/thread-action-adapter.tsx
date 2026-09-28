import { useEmail } from '@core/context/user';
import { useNonPrimaryEmailLinkIdHeader } from '@queries/email/link';
import {
  blockSenderWithToast,
  markSenderNoiseWithToast,
  markSenderSignalWithToast,
} from '@queries/email/thread';
import type { Accessor } from 'solid-js';
import type { EmailThreadCommands } from './context/email-thread-context';
import type { EmailThread } from './core/email-thread';
import { selectThreadSender } from './core/thread-messages';
import { createThreadCompletionAdapter } from './thread-completion-adapter';
import { createThreadReadAdapter } from './thread-read-adapter';

export function createThreadActionAdapter(
  threadId: Accessor<string>,
  threadSource: Accessor<EmailThread | undefined>
): EmailThreadCommands {
  const toHeaderLinkId = useNonPrimaryEmailLinkIdHeader();
  const completion = createThreadCompletionAdapter(
    threadSource,
    toHeaderLinkId
  );
  const read = createThreadReadAdapter(threadId, threadSource, toHeaderLinkId);
  const currentUserEmail = useEmail();

  const getSenderEmail = (): string | undefined => {
    const thread = threadSource();
    return thread ? selectThreadSender(thread, currentUserEmail()) : undefined;
  };

  const blockSender = () => {
    const senderEmail = getSenderEmail();
    if (!senderEmail) return false;
    blockSenderWithToast(senderEmail, toHeaderLinkId(threadSource()?.link_id));
    return true;
  };

  const markSenderSignal = () => {
    const senderEmail = getSenderEmail();
    if (!senderEmail) return false;
    markSenderSignalWithToast(
      senderEmail,
      toHeaderLinkId(threadSource()?.link_id)
    );
    return true;
  };

  const markSenderNoise = () => {
    const senderEmail = getSenderEmail();
    if (!senderEmail) return false;
    markSenderNoiseWithToast(
      senderEmail,
      toHeaderLinkId(threadSource()?.link_id)
    );
    return true;
  };

  return {
    ...completion,
    ...read,
    blockSender,
    markSenderSignal,
    markSenderNoise,
  };
}
