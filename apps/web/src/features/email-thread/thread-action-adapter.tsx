import { useEmail } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  useEmailLinksQuery,
  useNonPrimaryEmailLinkIdHeader,
} from '@queries/email/link';
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
  const linksQuery = useEmailLinksQuery();

  // A linked inbox can have an address other than the login, and mail sent
  // from it is the viewer's own too. Until links load, no sender is known.
  const getSenderEmail = (): string | undefined => {
    const thread = threadSource();
    const links = linksQuery.data?.links;
    if (!thread || !links) return undefined;
    const inbox = links.find((link) => link.id === thread.link_id);
    return selectThreadSender(thread, currentUserEmail(), inbox?.email_address);
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
