import type { ResultAsync } from 'neverthrow';
import { type Accessor, createSignal } from 'solid-js';
import type { FormWriteFailure } from '../context/form-context';
import type { FormDetail, FormLayout, SaveState } from '../core/form-model';

export type LayoutSaver = {
  /** Save `layout` once edits pause for the delay; a newer layout replaces it. */
  schedule: (layout: FormLayout) => void;
  /** Send what is scheduled now; resolves once nothing is left to send. */
  flush: () => Promise<void>;
  /** Hold sends (a column the layout names is still being created) until released. */
  hold: () => () => void;
  /** Send what is scheduled unless held; resolves once no save is in flight. Never waits for holds. */
  settled: () => Promise<void>;
  state: Accessor<SaveState>;
};

/**
 * Layout saves, debounced and one at a time: edits within `delayMs` of each
 * other coalesce into one `PUT`, and a layout changed while one is in flight
 * goes after it, so the server never sees an older layout last.
 */
export function createLayoutSaver(options: {
  save: (layout: FormLayout) => ResultAsync<FormDetail, FormWriteFailure>;
  delayMs: number;
  /** A save landed; `idle` when nothing newer is waiting to be sent. */
  onSaved: (detail: FormDetail, idle: boolean) => void;
  /** A save was refused; `newerPending` when a later layout still goes out. */
  onFailed: (failure: FormWriteFailure, newerPending: boolean) => void;
}): LayoutSaver {
  const [state, setState] = createSignal<SaveState>('saved');
  let latest: FormLayout | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let holds = 0;
  let waiters: (() => void)[] = [];
  let quietWaiters: (() => void)[] = [];

  const settleWaiters = () => {
    if (!inFlight && !(latest && holds === 0)) {
      const quiet = quietWaiters;
      quietWaiters = [];
      for (const resolve of quiet) resolve();
    }
    if (latest || inFlight || holds > 0) return;
    const settled = waiters;
    waiters = [];
    for (const resolve of settled) resolve();
  };

  const clearTimer = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  function send() {
    if (inFlight || holds > 0 || !latest) return;
    clearTimer();
    const layout = latest;
    latest = undefined;
    setState('saving');
    inFlight = (async () => {
      const result = await options.save(layout);
      inFlight = undefined;
      if (result.isErr()) {
        // A layout scheduled during the refused save is newer: it still goes.
        const newerPending = !!latest;
        setState(newerPending ? 'pending' : 'failed');
        options.onFailed(result.error, newerPending);
        if (newerPending && timer === undefined) send();
        settleWaiters();
        return;
      }
      const idle = !latest && holds === 0 && timer === undefined;
      setState(idle ? 'saved' : 'pending');
      options.onSaved(result.value, idle);
      // A layout scheduled during the flight whose delay already ran goes now.
      if (latest && timer === undefined) send();
      settleWaiters();
    })();
  }

  return {
    schedule(layout) {
      latest = layout;
      setState('pending');
      clearTimer();
      timer = setTimeout(() => {
        timer = undefined;
        send();
      }, options.delayMs);
    },
    flush() {
      clearTimer();
      send();
      return new Promise<void>((resolve) => {
        waiters.push(resolve);
        settleWaiters();
      });
    },
    settled() {
      clearTimer();
      send();
      return new Promise<void>((resolve) => {
        quietWaiters.push(resolve);
        settleWaiters();
      });
    },
    hold() {
      holds += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holds -= 1;
        if (holds === 0 && latest && timer === undefined) send();
        settleWaiters();
      };
    },
    state,
  };
}
