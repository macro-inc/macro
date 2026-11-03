import { useEmail } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { useInboxEmail } from '@queries/email/inbox-email';
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
  const viewerEmail = useInboxEmail(() => threadSource()?.link_id);
  const loginEmail = useEmail();

  // Mail sent from the Macro login is the viewer's own too, even in an inbox
  // linked under another address. Until the inbox address loads, no sender
  // is known.
  const getSenderEmail = (): string | undefined => {
    const thread = threadSource();
    return thread
      ? selectThreadSender(thread, viewerEmail(), loginEmail())
      : undefined;
  };

  const blockSender = () => {
    const senderEmail = getSenderEmail();
    if (!senderEmail) return false;
    fireAndForget(
      blockSenderWithToast(
        senderEmail,
        toHeaderLinkId(threadSource()?.link_id)
      ),
      'email-thread'
    );
    return true;
  };

  const markSenderSignal = () => {
    const senderEmail = getSenderEmail();
    if (!senderEmail) return false;
    fireAndForget(
      markSenderSignalWithToast(
        senderEmail,
        toHeaderLinkId(threadSource()?.link_id)
      ),
      'email-thread'
    );
    return true;
  };

  const markSenderNoise = () => {
    const senderEmail = getSenderEmail();
    if (!senderEmail) return false;
    fireAndForget(
      markSenderNoiseWithToast(
        senderEmail,
        toHeaderLinkId(threadSource()?.link_id)
      ),
      'email-thread'
    );
    return true;
  };

  return {
    ...completion,
    ...read,
    canActOnSender: () => getSenderEmail() !== undefined,
    blockSender,
    markSenderSignal,
    markSenderNoise,
  };
}
