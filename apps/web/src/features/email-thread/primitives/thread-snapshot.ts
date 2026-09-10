import { createMemo } from 'solid-js';
import type { EmailThreadSource } from '../context/email-thread-context';
import type { EmailThread } from '../core/email-thread';

/** Keep the current thread readable during transient reloads; never show a previous thread. */
export function createThreadSnapshot(
  source: Pick<EmailThreadSource, 'id' | 'thread' | 'isLoading' | 'isError'>
) {
  const snapshot = createMemo<{ id: string; thread?: EmailThread }>(
    (previous) => {
      const id = source.id();
      const current = source.thread();
      if (current?.db_id === id) return { id, thread: current };
      const canRetain = source.isLoading() || source.isError();
      return {
        id,
        thread: canRetain && previous?.id === id ? previous.thread : undefined,
      };
    }
  );
  return () => snapshot().thread;
}
