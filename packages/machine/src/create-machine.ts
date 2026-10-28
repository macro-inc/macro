import { step } from './simulate';
import type { Cleanup, Machine, MachineOptions, MachineScope } from './types';

/** Maximum events processed in one synchronous drain before assuming a cycle. */
export const MAX_CHAINED_DISPATCHES = 1000;

const TRAIL_LENGTH = 20;

export class DispatchCycleError extends Error {
  constructor(readonly trail: readonly unknown[]) {
    super(
      `createMachine: ${MAX_CHAINED_DISPATCHES} chained dispatches without settling. ` +
        'A scope, command, subscriber, or cleanup is dispatching in a cycle. ' +
        `Last ${trail.length} events are attached as \`trail\`.`
    );
    this.name = 'DispatchCycleError';
  }
}

/**
 * Run a pure definition using ordinary TypeScript state. Scopes own cleanup,
 * commands perform individual actions, and all nested events are serialized.
 * The caller owns disposal; UI adapters can tie it to their own lifecycle.
 */
export function createMachine<S extends { t: string }, E, C = never>(
  options: MachineOptions<S, E, C>
): Machine<S, E> {
  let state = options.initial;
  let disposed = false;
  let draining = false;
  let disposeScope: Cleanup | undefined;
  const listeners = new Set<(state: S) => void>();
  const queue: E[] = [];
  const trail: E[] = [];

  const dispatch = (event: E): void => {
    if (disposed) return;
    queue.push(event);
    if (!draining) drain();
  };

  const unmountScope = () => {
    const cleanup = disposeScope;
    disposeScope = undefined;
    cleanup?.();
  };

  const mountScope = () => {
    // The state tag selects the callback typed for exactly this state.
    const scope = options.scopes?.[state.t as S['t']] as
      | MachineScope<S, E>
      | undefined;
    const cleanup = scope?.(state, dispatch);
    // A callback can dispose the machine before returning its cleanup.
    if (disposed) cleanup?.();
    else disposeScope = cleanup ?? undefined;
  };

  const apply = (event: E) => {
    const result = step(options.def, state, event);
    options.inspect?.(state, event, result ?? 'ignored');
    if (result === undefined || disposed) return;

    // The outgoing cleanup still sees its own state through getState().
    unmountScope();
    if (disposed) return;
    state = result.state;
    mountScope();

    // Snapshot the listeners so subscribing during notification takes effect
    // on the next transition. Unsubscribing takes effect immediately.
    for (const listener of [...listeners]) {
      if (disposed) return;
      if (listeners.has(listener)) listener(state);
    }

    for (const command of result.commands ?? []) {
      if (disposed) return;
      options.execute?.(command, dispatch);
    }
  };

  const drain = () => {
    draining = true;
    let steps = 0;
    try {
      while (queue.length > 0) {
        if (++steps > MAX_CHAINED_DISPATCHES) {
          throw new DispatchCycleError([...trail]);
        }
        const event = queue.shift() as E;
        trail.push(event);
        if (trail.length > TRAIL_LENGTH) trail.shift();
        apply(event);
      }
    } finally {
      draining = false;
      // Failed transitions must not replay queued events on the next dispatch.
      queue.length = 0;
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    queue.length = 0;
    listeners.clear();
    unmountScope();
  };

  // An initial scope can send events before createMachine returns. Finish
  // mounting it before draining, and release its resources if startup fails.
  try {
    draining = true;
    mountScope();
    draining = false;
    if (queue.length > 0) drain();
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    getState: () => state,
    dispatch,
    subscribe: (listener) => {
      if (!disposed) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose,
  };
}
