import type { EmailMessage } from '../../email-message/core/email-message';
import type {
  EmailThreadContext,
  EmailThreadSource,
} from '../context/email-thread-context';
import type { EmailThread } from '../core/email-thread';

export { message } from '../../email-message/tests/messages';

export function thread(
  messages: EmailMessage[],
  overrides: Partial<EmailThread> = {}
): EmailThread {
  return {
    db_id: 'thread',
    link_id: 'inbox',
    access_level: 'owner',
    inbox_visible: true,
    is_read: true,
    messages,
    ...overrides,
  };
}

export function createThreadContext(
  source: Pick<EmailThreadSource, 'thread'> & Partial<EmailThreadSource>
): EmailThreadContext {
  return {
    source: {
      id: () => source.thread()?.db_id ?? 'thread',
      isError: () => false,
      isLoading: () => false,
      isFetching: () => false,
      isFetchingOlder: () => false,
      hasMore: () => false,
      async fetchOlder() {},
      async refresh() {},
      ...source,
    },
    recipients: () => [],
    viewerEmail: () => 'viewer@example.com',
    viewerLoading: () => false,
    isTouch: () => false,
    isMobile: () => false,
    createCommands: () => ({
      archiveThread: () => false,
      isThreadDone: () => false,
      canMarkThreadNotDone: () => false,
      markThreadNotDone: () => false,
      isThreadMarkedUnread: () => false,
      markThreadUnread: () => false,
      markThreadRead: () => false,
      getMarkDoneNavigationTargetId: () => undefined,
      blockSender: () => false,
      markSenderSignal: () => false,
      markSenderNoise: () => false,
    }),
  };
}
