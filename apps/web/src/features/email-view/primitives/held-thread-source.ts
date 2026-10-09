import type { EmailThreadSource } from '@app/features/email-thread/context/email-thread-context';
import type { EmailThread } from '@app/features/email-thread/core/email-thread';
import { type Accessor, createMemo } from 'solid-js';

/**
 * Keeps the last loaded thread on screen while `holding` is true and the
 * requested thread has not loaded, so stepping through the list does not
 * flash a loading state for every thread passed over.
 */
export function createHeldThreadSource(options: {
  threadId: Accessor<string>;
  source: EmailThreadSource;
  holding: Accessor<boolean>;
}): {
  threadId: Accessor<string>;
  source: EmailThreadSource;
  isHeld: Accessor<boolean>;
} {
  const { source } = options;
  const shown = createMemo<{ id: string; thread: EmailThread } | undefined>(
    (previous) => {
      const id = options.threadId();
      const thread = source.thread();
      if (thread) return { id, thread };
      if (
        previous &&
        previous.id !== id &&
        options.holding() &&
        !source.isError()
      ) {
        return previous;
      }
      return undefined;
    }
  );
  const held = () => {
    const current = shown();
    return current && current.id !== options.threadId() ? current : undefined;
  };

  return {
    threadId: () => held()?.id ?? options.threadId(),
    isHeld: () => held() !== undefined,
    source: {
      ...source,
      id: () => held()?.thread.db_id ?? source.id(),
      thread: () => held()?.thread ?? source.thread(),
      isError: () => !held() && source.isError(),
      isLoading: () => !held() && source.isLoading(),
    },
  };
}
