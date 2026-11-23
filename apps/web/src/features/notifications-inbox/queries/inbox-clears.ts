import { fireAndForget } from '@core/util/fireAndForget';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import {
  type InboxClearState,
  isClearRunning,
  withClear,
} from '../core/inbox-clear';
import { readInboxClears } from './notification-inbox-mutations';

/** How often a clear still at work is read again, in case a hint was missed. */
const CLEAR_POLL_MS = 2_000;
/**
 * How often a visible inbox asks which clears are at work, in case the hint
 * that one started on another device was missed.
 */
const CLEAR_DISCOVERY_MS = 15_000;

export type InboxClearsOptions = {
  client: Accessor<Client>;
  enabled: Accessor<boolean>;
  /**
   * Subscribes, under the caller's owner, to the server's hints that one of
   * the viewer's clears changed. Hints are best effort and never replayed.
   */
  onClearUpdated?: (listener: (clearId: string) => void) => void;
  /** Subscribes to transport reconnects, after which hints may be missed. */
  onReconnected?: (listener: () => void) => () => void;
  /** A clear or its undo finished on the server; the inbox is read again. */
  onSettled: () => void;
};

/**
 * The viewer's clears that the server is still working through, whichever
 * device started them. The server owns a clear, so this only follows it:
 * hints say when one changed. Hints can be missed, so a clear still at work
 * is read again on a timer, and a visible inbox asks now and then, and after
 * a reconnect, which clears are at work.
 */
export function createInboxClears(options: InboxClearsOptions) {
  const [running, setRunning] = createSignal<readonly InboxClearState[]>([]);
  const waiting = new Map<
    string,
    ((clear: InboxClearState | undefined) => void)[]
  >();

  const settle = (id: string, clear: InboxClearState | undefined) => {
    setRunning((current) => current.filter((held) => held.id !== id));
    for (const resolve of waiting.get(id) ?? []) resolve(clear);
    waiting.delete(id);
  };

  /** Take in a copy of a clear, unless a newer one is already held. */
  const observe = (clear: InboxClearState) => {
    const held = running().find((candidate) => candidate.id === clear.id);
    if (held && held.revision > clear.revision) return;
    if (isClearRunning(clear.status)) {
      setRunning((current) => withClear(current, clear));
      return;
    }
    settle(clear.id, clear);
    options.onSettled();
  };

  /** Read one clear, or without an id every clear still at work. */
  const read = async (id?: string) => {
    let clears: InboxClearState[];
    try {
      clears = await readInboxClears(options.client(), id);
    } catch {
      // The next poll, hint or reconnect reads again.
      return;
    }
    for (const clear of clears) observe(clear);
    // The server has forgotten a clear it finished long ago.
    if (id !== undefined && clears.length === 0 && waiting.has(id)) {
      settle(id, undefined);
      options.onSettled();
    }
  };

  const readRunning = () => {
    for (const clear of running()) {
      fireAndForget(read(clear.id), 'notifications-inbox');
    }
  };

  createEffect(
    on(options.enabled, (enabled) => {
      if (enabled) fireAndForget(read(), 'notifications-inbox');
    })
  );
  const poll = setInterval(readRunning, CLEAR_POLL_MS);
  onCleanup(() => clearInterval(poll));
  const discovery = setInterval(() => {
    if (options.enabled() && document.visibilityState === 'visible') {
      fireAndForget(read(), 'notifications-inbox');
    }
  }, CLEAR_DISCOVERY_MS);
  onCleanup(() => clearInterval(discovery));
  options.onClearUpdated?.((id) => {
    if (options.enabled()) fireAndForget(read(id), 'notifications-inbox');
  });
  const unsubscribe = options.onReconnected?.(() => {
    if (options.enabled()) fireAndForget(read(), 'notifications-inbox');
  });
  if (unsubscribe) onCleanup(unsubscribe);

  return {
    /** The clears still at work on the server. */
    running,
    /** Follow a clear this tab started or undid. */
    observe,
    /**
     * Resolves once the server has finished the clear or its undo, to the
     * clear as it ended; undefined if the server no longer has it.
     */
    settled: (id: string) =>
      new Promise<InboxClearState | undefined>((resolve) => {
        waiting.set(id, [...(waiting.get(id) ?? []), resolve]);
        if (!running().some((clear) => clear.id === id)) {
          fireAndForget(read(id), 'notifications-inbox');
        }
      }),
  };
}
