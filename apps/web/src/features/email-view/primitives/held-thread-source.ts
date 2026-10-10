import type { EmailThreadSource } from '@app/features/email-thread/context/email-thread-context';
import type { EmailThread } from '@app/features/email-thread/core/email-thread';
import { makeEventListener } from '@solid-primitives/event-listener';
import { type Accessor, createMemo, createSignal, onCleanup } from 'solid-js';

type ShownThread = { id: string; thread: EmailThread };

export type ThreadNavigationHold = {
  /** Whether the key that last stepped between threads is still down. */
  held: Accessor<boolean>;
  press: (event: KeyboardEvent) => void;
  lastShown: () => ShownThread | undefined;
  remember: (shown: ShownThread | undefined) => void;
};

/**
 * Outlives each thread's detail view, which remounts per thread, so the
 * held key and the last loaded thread carry over to the next view.
 */
export function createThreadNavigationHold(): ThreadNavigationHold {
  const [heldKey, setHeldKey] = createSignal<string>();
  let lastShown: ShownThread | undefined;
  // Capture phase: handlers that stop propagation must not strand the hold.
  makeEventListener(
    window,
    'keyup',
    (event) => {
      if (event.key.toLowerCase() === heldKey()) setHeldKey(undefined);
    },
    true
  );
  makeEventListener(window, 'blur', () => setHeldKey(undefined));

  return {
    held: () => heldKey() !== undefined,
    press: (event) => setHeldKey(event.key.toLowerCase()),
    lastShown: () => lastShown,
    remember: (shown) => {
      lastShown = shown;
    },
  };
}

/**
 * Keeps the last loaded thread on screen while the navigation key is held
 * and the requested thread has not loaded, so stepping through the list does
 * not flash a loading state for every thread passed over.
 */
export function createHeldThreadSource(options: {
  threadId: Accessor<string>;
  source: EmailThreadSource;
  hold: ThreadNavigationHold;
}): {
  threadId: Accessor<string>;
  source: EmailThreadSource;
  isHeld: Accessor<boolean>;
} {
  const { source, hold } = options;
  const shown = createMemo<ShownThread | undefined>((previous) => {
    const id = options.threadId();
    const thread = source.thread();
    if (thread) return { id, thread };
    if (previous && previous.id !== id && hold.held() && !source.isError()) {
      return previous;
    }
    return undefined;
  }, hold.lastShown());
  onCleanup(() => hold.remember(shown()));
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
