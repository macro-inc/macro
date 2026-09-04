import {
  type Accessor,
  batch,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
} from 'solid-js';

/**
 * A reactive runner for a pure state machine.
 *
 * The machine is split in two:
 *
 * - `MachineDef` — the pure half. One entry per state, each with an `on`
 *   function from (narrowed state, event) to the next state plus any one-shot
 *   commands. Lives in `domain/`, imports nothing reactive, tests as values.
 * - `createMachine` — the reactive half. Holds the state in a signal, runs
 *   per-state `scopes` (level-triggered effects disposed on exit), executes
 *   commands (edge-triggered effects), and serializes dispatches.
 *
 * Effects are sorted by kind, each with exactly one home:
 *
 * | thing                             | home                          |
 * | --------------------------------- | ----------------------------- |
 * | decisions, guards, explicit no-op | `def`                         |
 * | effect with a lifetime            | `scopes` (entry → exit)       |
 * | one-shot effect                   | `execute` (per command)       |
 * | condition over external inputs    | a memo over `state()` outside |
 * | observation                       | `inspect`                     |
 *
 * There is deliberately no way to subscribe the machine to external signals.
 * Conditions are evaluated where their inputs live and arrive as events.
 */

/** Next state plus the one-shot commands the runner must execute for taking this arrow. */
export type Transition<S, C> = {
  readonly state: S;
  readonly commands?: readonly C[];
};

/**
 * One entry per state — the mapped key is non-optional, so adding a member to
 * `S` fails to compile until its entry exists. Forgetting a state is a type
 * error; not handling an event (returning `undefined`) is a decision.
 */
export type MachineDef<S extends { t: string }, E, C = never> = {
  readonly [K in S['t']]: {
    readonly on: (
      s: Extract<S, { t: K }>,
      e: E
    ) => Transition<S, C> | undefined;
  };
};

/**
 * Level-triggered effects. A scope runs under a child owner when its state
 * is entered and that owner is disposed when the state is exited — so every
 * `onCleanup` inside means "on leaving this state".
 *
 * Every transition disposes and remounts, including a transition to the same
 * `t` with a new payload. The state is therefore constant for a scope's
 * lifetime and is passed as a value. If a lifetime must survive a payload
 * change, that payload is not state: derive it, or split the state.
 */
export type MachineScopes<S extends { t: string }, E, V> = {
  readonly [K in S['t']]?: (
    s: Extract<S, { t: K }>,
    dispatch: (e: E) => void
  ) => V;
};

export type MachineOptions<S extends { t: string }, E, C, V> = {
  readonly initial: S;
  readonly def: MachineDef<S, E, C>;
  readonly scopes?: MachineScopes<S, E, V> | undefined;
  /** Edge-triggered: called once per command, in order, after the state has changed. */
  readonly execute?: ((cmd: C, dispatch: (e: E) => void) => void) | undefined;
  /**
   * Observation only. Receives every dispatch, including ignored ones. Cannot
   * participate. `| undefined` so callers can gate it on an env flag inline.
   */
  readonly inspect?:
    | ((from: S, e: E, result: Transition<S, C> | 'ignored') => void)
    | undefined;
};

export type Machine<S extends { t: string }, E, V> = {
  /** The single reactive source of truth. Derive everything else from it. */
  readonly state: Accessor<S>;
  /** Whatever the current state's scope returned; `undefined` when it has none. */
  readonly value: Accessor<V | undefined>;
  /** The only mutation path. Reentrancy-safe, never reentrant: nested dispatches queue. */
  readonly dispatch: (e: E) => void;
  /** Narrow-and-read: `m.matches('flashing')?.target`. */
  readonly matches: <K extends S['t']>(
    k: K
  ) => Extract<S, { t: K }> | undefined;
};

/**
 * Chained dispatches allowed within one drain before the runner assumes a
 * cycle. A scope, command, or cleanup dispatching an event that leads back
 * to itself should detonate in development, not spin a tab.
 */
export const MAX_CHAINED_DISPATCHES = 1000;

const TRAIL_LENGTH = 20;

export class DispatchCycleError extends Error {
  constructor(readonly trail: readonly unknown[]) {
    super(
      `createMachine: ${MAX_CHAINED_DISPATCHES} chained dispatches without settling. ` +
        'A scope, command, or cleanup is dispatching in a cycle. ' +
        `Last ${trail.length} events are attached as \`trail\`.`
    );
    this.name = 'DispatchCycleError';
  }
}

export function createMachine<
  S extends { t: string },
  E,
  C = never,
  V = undefined,
>(options: MachineOptions<S, E, C, V>): Machine<S, E, V> {
  const owner = getOwner();
  const [state, setState] = createSignal<S>(options.initial);
  const [value, setValue] = createSignal<V | undefined>(undefined);

  let disposed = false;
  let draining = false;
  let disposeScope: (() => void) | undefined;
  const queue: E[] = [];
  const trail: E[] = [];

  const dispatch = (e: E): void => {
    if (disposed) return;
    queue.push(e);
    if (!draining) drain();
  };

  const unmountScope = () => {
    const dispose = disposeScope;
    disposeScope = undefined;
    dispose?.();
  };

  const mountScope = (s: S) => {
    const scope = options.scopes?.[s.t as S['t']];
    if (scope === undefined) {
      setValue(undefined);
      return;
    }
    // The record key guarantees `s` is the member the scope is typed for;
    // TypeScript cannot relate `scopes[s.t]` to `s` without this cast.
    const run = scope as (s: S, dispatch: (e: E) => void) => V;
    createRoot((dispose) => {
      disposeScope = dispose;
      const v = run(s, dispatch);
      setValue(() => v);
    }, owner);
  };

  const step = (e: E) => {
    const from = state();
    const entry = options.def[from.t as S['t']];
    // Same cast, same reason: `def[from.t].on` is typed for exactly `from`.
    const on = entry.on as (s: S, e: E) => Transition<S, C> | undefined;
    const result = on(from, e);
    options.inspect?.(from, e, result ?? 'ignored');
    if (result === undefined) return;

    batch(() => {
      // Order matters: the outgoing scope's cleanups run while `state()`
      // still reads the state they were mounted for.
      unmountScope();
      setState(() => result.state);
      mountScope(result.state);
    });

    if (result.commands !== undefined && options.execute !== undefined) {
      for (const cmd of result.commands) options.execute(cmd, dispatch);
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
        const e = queue.shift() as E;
        trail.push(e);
        if (trail.length > TRAIL_LENGTH) trail.shift();
        step(e);
      }
    } finally {
      draining = false;
      // On a throw, drop whatever was queued rather than replay the cycle.
      queue.length = 0;
    }
  };

  // Events dispatched by the initial scope wait until it has finished mounting.
  draining = true;
  mountScope(options.initial);
  draining = false;
  if (queue.length > 0) drain();

  if (owner !== null) {
    onCleanup(() => {
      // Set before unmounting so a cleanup that dispatches is a no-op, and so
      // commands that outlive the component (a RAF, a settled promise) are too.
      disposed = true;
      unmountScope();
    });
  }

  const matches = <K extends S['t']>(k: K) => {
    const s = state();
    return s.t === k ? (s as Extract<S, { t: K }>) : undefined;
  };

  return { state, value, dispatch, matches };
}
