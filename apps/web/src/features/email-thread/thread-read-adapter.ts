import { markEmailReadOnOpen } from '@app/preferences/email-read-on-open';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  useMarkThreadAsSeenMutation,
  useMarkThreadAsUnreadMutation,
} from '@queries/email/thread';
import { refetchSoupEntity } from '@queries/soup/cache';
import type { Accessor } from 'solid-js';
import { createEffect, createMemo, createSignal, on } from 'solid-js';
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

  // Viewing a thread marks it read (EmailReadMarker), so each thread starts
  // with the toggle offering Mark Unread. With "Mark as read when opened" off,
  // an unread thread stays unread and starts offering Mark Read; a toggle
  // overrides it.
  const [unreadToggle, setUnreadToggle] = createSignal<boolean>();
  const threadMarkedUnread = () =>
    unreadToggle() ??
    (!markEmailReadOnOpen() && threadSource()?.is_read === false);
  const [threadMarkedRead, setThreadMarkedRead] = createSignal(false);

  // A queued refusal can arrive after a later toggle.
  let readToggleVersion = 0;
  let unreadWriteVersion = 0;
  // The source also updates when the current thread's own write changes it.
  const currentThreadId = createMemo(threadId);
  createEffect(
    on(currentThreadId, () => {
      readToggleVersion += 1;
      setUnreadToggle(undefined);
      setThreadMarkedRead(false);
    })
  );

  const showUnreadSuccess = () => {
    toast.success('Marked as unread', {
      duration: 3_000,
      stack: true,
      hideOnMobile: true,
    });
  };
  const showUnreadFailure = (unreadThreadId: string, version: number) => {
    if (threadId() === unreadThreadId && readToggleVersion === version) {
      setUnreadToggle(false);
    }
    toast.failure('Failed to mark as unread');
    fireAndForget(
      refetchSoupEntity(unreadThreadId, 'emailThread'),
      'email-thread'
    );
  };
  // The inline thread can close before the write settles. Queue admission
  // releases the toggle while the cache still owns the network request.
  const markUnreadMutation = useMarkThreadAsUnreadMutation(
    {
      onSuccess: (result, { threadId: unreadThreadId }) => {
        if (result.kind === 'committed') {
          showUnreadSuccess();
          return;
        }
        if (!result.settlement) return;
        const version = unreadWriteVersion;
        fireAndForget(
          (async () => {
            const settlement = await result.settlement;
            if (settlement === 'committed') showUnreadSuccess();
            if (settlement === 'permanently-failed') {
              showUnreadFailure(unreadThreadId, version);
            }
          })(),
          'email-thread'
        );
      },
      onError: (_error, { threadId: unreadThreadId }) => {
        showUnreadFailure(unreadThreadId, unreadWriteVersion);
      },
    },
    { observeQueuedSettlement: true }
  );

  const markThreadUnread = () => {
    const thread = threadSource();
    if (!thread?.db_id) return false;
    if (threadMarkedUnread()) return false;
    // A toggle mid-flight would race the pending request; ignore it.
    if (markUnreadMutation.isPending || markSeenMutation.isPending) {
      return false;
    }

    readToggleVersion += 1;
    unreadWriteVersion = readToggleVersion;
    setUnreadToggle(true);
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

    const readThreadId = thread.db_id;
    readToggleVersion += 1;
    const version = readToggleVersion;
    setUnreadToggle(false);
    setThreadMarkedRead(true);
    markSeenMutation.mutate(
      { threadId: readThreadId },
      {
        onSuccess: () => {
          toast.success('Marked as read', {
            duration: 3_000,
            stack: true,
            hideOnMobile: true,
          });
        },
        onError: () => {
          if (threadId() === readThreadId && readToggleVersion === version) {
            setUnreadToggle(true);
            setThreadMarkedRead(false);
          }
          toast.failure('Failed to mark as read');
          fireAndForget(
            refetchSoupEntity(readThreadId, 'emailThread'),
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
