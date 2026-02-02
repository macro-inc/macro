import { createBlockSignal } from '@core/block';
import type { Message } from '@service-comms/generated/models/message';
import { useSearchParams } from '@solidjs/router';

export type MessageWithThreadId = Message & {
  thread_id: NonNullable<Message['thread_id']>;
};

/** stores the id of the thread currently being viewed */
export const activeThreadIdSignal = createBlockSignal<string>();

/** Toggle the active thread by id
 * if the thread is already active, it will be closed */
export function toggleThread(threadId?: string) {
  const [, setSearchParams] = useSearchParams();
  const [activeThreadId, setActiveThreadId] = activeThreadIdSignal;

  if (activeThreadId() === threadId) {
    setActiveThreadId(undefined);
    setSearchParams({ thread_id: undefined });
  } else {
    setActiveThreadId(threadId);
    setSearchParams({ thread_id: threadId });
  }
}
