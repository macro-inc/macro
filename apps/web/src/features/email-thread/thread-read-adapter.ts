import { toast } from '@core/component/Toast/Toast';
import {
  useMarkThreadAsSeenMutation,
  useMarkThreadAsUnreadMutation,
} from '@queries/email/thread';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { Accessor } from 'solid-js';
import { createEffect, createSignal } from 'solid-js';
import type { EmailThreadCommands } from './context/email-thread-context';
import type { EmailThread } from './core/email-thread';

export function createThreadReadAdapter(
  threadId: Accessor<string>,
  threadSource: Accessor<EmailThread | undefined>,
  toHeaderLinkId: (linkId: string | null | undefined) => string | undefined
): Pick<
  EmailThreadCommands,
  'markThreadUnread' | 'markThreadRead' | 'isThreadMarkedUnread'
> {
  const markSeenMutation = useMarkThreadAsSeenMutation();
  const markUnreadMutation = useMarkThreadAsUnreadMutation();

  // Viewing a thread marks it read (EmailDebouncedReadMarker), so each thread
  // starts with the toggle offering Mark Unread.
  const [threadMarkedUnread, setThreadMarkedUnread] = createSignal(false);
  createEffect(() => {
    void threadId();
    setThreadMarkedUnread(false);
  });

  const markThreadUnread = () => {
    const thread = threadSource();
    if (!thread?.db_id) return false;
    if (threadMarkedUnread()) return false;
    // A toggle mid-flight would race the pending request; ignore it.
    if (markUnreadMutation.isPending || markSeenMutation.isPending) {
      return false;
    }

    const threadId = thread.db_id;
    setThreadMarkedUnread(true);
    markUnreadMutation.mutate(
      { threadId, linkId: thread.link_id },
      {
        onSuccess: () => {
          toast.success('Marked as unread', {
            duration: 3_000,
            stack: true,
            hideOnMobile: true,
          });
        },
        onError: () => {
          setThreadMarkedUnread(false);
          toast.failure('Failed to mark as unread');
          void refetchSoupEntity(threadId, 'emailThread');
        },
      }
    );
    return true;
  };

  const markThreadRead = () => {
    const thread = threadSource();
    if (!thread?.db_id) return false;
    if (!threadMarkedUnread()) return false;
    // A toggle mid-flight would race the pending request; ignore it.
    if (markUnreadMutation.isPending || markSeenMutation.isPending) {
      return false;
    }

    const threadId = thread.db_id;
    setThreadMarkedUnread(false);
    markSeenMutation.mutate(
      { threadId, linkId: toHeaderLinkId(thread.link_id) },
      {
        onSuccess: () => {
          toast.success('Marked as read', {
            duration: 3_000,
            stack: true,
            hideOnMobile: true,
          });
        },
        onError: () => {
          setThreadMarkedUnread(true);
          toast.failure('Failed to mark as read');
          void refetchSoupEntity(threadId, 'emailThread');
        },
      }
    );
    return true;
  };

  return {
    markThreadUnread,
    markThreadRead,
    isThreadMarkedUnread: threadMarkedUnread,
  };
}
