import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
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
  threadSource: Accessor<EmailThread | undefined>
): Pick<
  EmailThreadCommands,
  | 'markThreadUnread'
  | 'markThreadRead'
  | 'isThreadMarkedUnread'
  | 'isThreadMarkedRead'
> {
  const markSeenMutation = useMarkThreadAsSeenMutation();

  // Viewing a thread marks it read (EmailReadMarker), so each thread
  // starts with the toggle offering Mark Unread.
  const [threadMarkedUnread, setThreadMarkedUnread] = createSignal(false);
  const [threadMarkedRead, setThreadMarkedRead] = createSignal(false);
  createEffect(() => {
    void threadId();
    setThreadMarkedUnread(false);
    setThreadMarkedRead(false);
  });

  // The inline thread can close before the unread write settles.
  const markUnreadMutation = useMarkThreadAsUnreadMutation({
    onSuccess: () => {
      toast.success('Marked as unread', {
        duration: 3_000,
        stack: true,
        hideOnMobile: true,
      });
    },
    onError: (_error, { threadId: unreadThreadId }) => {
      if (threadId() === unreadThreadId) setThreadMarkedUnread(false);
      toast.failure('Failed to mark as unread');
      fireAndForget(
        refetchSoupEntity(unreadThreadId, 'emailThread'),
        'email-thread'
      );
    },
  });

  const markThreadUnread = () => {
    const thread = threadSource();
    if (!thread?.db_id) return false;
    if (threadMarkedUnread()) return false;
    // A toggle mid-flight would race the pending request; ignore it.
    if (markUnreadMutation.isPending || markSeenMutation.isPending) {
      return false;
    }

    setThreadMarkedUnread(true);
    setThreadMarkedRead(false);
    markUnreadMutation.mutate({ threadId: thread.db_id });
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
    setThreadMarkedRead(true);
    markSeenMutation.mutate(
      { threadId },
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
          setThreadMarkedRead(false);
          toast.failure('Failed to mark as read');
          fireAndForget(
            refetchSoupEntity(threadId, 'emailThread'),
            'email-thread'
          );
        },
      }
    );
    return true;
  };

  return {
    markThreadUnread,
    markThreadRead,
    isThreadMarkedUnread: threadMarkedUnread,
    isThreadMarkedRead: threadMarkedRead,
  };
}
