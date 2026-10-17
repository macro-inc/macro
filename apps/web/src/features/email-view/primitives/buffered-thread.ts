import {
  startUiOperation,
  type UiOperation,
} from '@app/observability/ui-operation';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';

/** How long a slow thread may keep the previous one on screen. */
export const THREAD_SWITCH_DEADLINE_MS = 1000;

export type BufferedThread = {
  /** The thread on screen. */
  shown: Accessor<string>;
  /** Threads to keep mounted: the one on screen and the one loading behind. */
  mounted: Accessor<string[]>;
  /** A thread finished rendering; it replaces the one on screen if requested. */
  settle: (threadId: string) => void;
};

/**
 * Keeps the open thread on screen while the next one loads behind it. A
 * requested thread is shown once it settles or after the deadline; a request
 * superseded before then is never shown.
 *
 * Each open is an `email.thread.switch` UI operation, from the request to the
 * thread on screen: `success` once it rendered, `timeout` when the deadline
 * showed it still loading, `cancelled` when another request replaced it.
 */
export function createBufferedThread(
  requested: Accessor<string>,
  deadlineMs = THREAD_SWITCH_DEADLINE_MS
): BufferedThread {
  const initial = untrack(requested);
  const [shown, setShown] = createSignal(initial);
  let pending: { threadId: string; operation: UiOperation } | undefined = {
    threadId: initial,
    operation: startSwitch(initial, 'open'),
  };

  const show = (threadId: string, rendered: boolean) => {
    if (requested() !== threadId) return;
    setShown(threadId);
    if (pending?.threadId !== threadId) return;
    const { operation } = pending;
    pending = undefined;
    if (!rendered) return operation.finish('timeout');
    operation.mark('rendered');
    operation.afterPaint();
  };

  createEffect(
    on(
      requested,
      (threadId) => {
        pending?.operation.finish('cancelled');
        pending = undefined;
        // Stepping back to the thread on screen leaves nothing to load.
        if (threadId === shown()) return;
        const operation = startSwitch(threadId, 'switch');
        pending = { threadId, operation };
        const deadline = setTimeout(() => show(threadId, false), deadlineMs);
        onCleanup(() => clearTimeout(deadline));
      },
      { defer: true }
    )
  );
  onCleanup(() => pending?.operation.finish('cancelled'));

  return {
    shown,
    mounted: () => [...new Set([shown(), requested()])],
    settle: (threadId) => show(threadId, true),
  };
}

function startSwitch(threadId: string, kind: 'open' | 'switch') {
  return startUiOperation('email.thread.switch', {
    attributes: { 'email.thread_id': threadId, 'email.switch.kind': kind },
  });
}
