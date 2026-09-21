import {
  type Accessor,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  untrack,
} from 'solid-js';
import { createMachine } from './create-machine';
import type { Machine, MachineOptions, MachineScope } from './types';

export type SolidMachine<S extends { t: string }, E> = Pick<
  Machine<S, E>,
  'dispatch' | 'dispose'
> & {
  readonly state: Accessor<S>;
  /** Read and narrow the reactive snapshot: `machine.matches('flashing')`. */
  readonly matches: <K extends S['t']>(
    tag: K
  ) => Extract<S, { t: K }> | undefined;
};

/** Create a machine whose snapshots are reactive and whose owner disposes it. */
export function createSolidMachine<S extends { t: string }, E, C = never>(
  options: MachineOptions<S, E, C>
): SolidMachine<S, E> {
  const machine = untrack(() => createMachine(options));
  const [snapshot, setState] = createSignal(machine.getState());
  const unsubscribe = machine.subscribe((next) => setState(() => next));
  const state = () => {
    // Track published snapshots while keeping imperative reads inside scope
    // entry/cleanup consistent with the core's current state.
    snapshot();
    return machine.getState();
  };
  const dispose = () => {
    unsubscribe();
    machine.dispose();
  };
  if (getOwner() !== null) onCleanup(dispose);

  return {
    state,
    dispatch: (event) => untrack(() => machine.dispatch(event)),
    dispose,
    matches: <K extends S['t']>(tag: K) => {
      const snapshot = state();
      return snapshot.t === tag
        ? (snapshot as Extract<S, { t: K }>)
        : undefined;
    },
  };
}

/**
 * Give a scope a Solid root for computations and context. Register cleanup
 * with onCleanup inside the callback. Capture the owner when configuring the
 * scope, so later dispatches inherit that context too.
 */
export function solidScope<S, E>(
  scope: (state: S, dispatch: (event: E) => void) => void
): MachineScope<S, E> {
  const owner = getOwner();
  return (state, dispatch) =>
    createRoot((dispose) => {
      try {
        scope(state, (event) => untrack(() => dispatch(event)));
        return dispose;
      } catch (error) {
        dispose();
        throw error;
      }
    }, owner);
}
