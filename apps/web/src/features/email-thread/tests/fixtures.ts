import type { EmailMessage } from '../../email-message/core/email-message';
import type {
  EmailThreadDependencies,
  EmailThreadSource,
} from '../context/email-thread-dependencies';
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
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    messages,
    ...overrides,
  };
}

export function dependencies(
  source: Omit<EmailThreadSource, 'id' | 'isError'> &
    Partial<Pick<EmailThreadSource, 'id' | 'isError'>>
): EmailThreadDependencies {
  return {
    source: {
      id: () => source.thread()?.db_id ?? 'thread',
      isError: () => false,
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
