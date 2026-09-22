/** Cleanup for a scope or subscription. */
export type Cleanup = () => void;

/** Next state and the commands to execute after entering it. */
export type Transition<S, C> = {
  readonly state: S;
  readonly commands?: readonly C[];
};

/**
 * Pure transition handlers, exhaustively keyed by state. Returning `undefined`
 * ignores an event and leaves the current state and scope untouched.
 */
export type MachineDef<S extends { t: string }, E, C = never> = {
  readonly [K in S['t']]: {
    readonly on: (
      s: Extract<S, { t: K }>,
      e: E
    ) => Transition<S, C> | undefined;
  };
};

/** Start work for a state instance and optionally return its cleanup. */
export type MachineScope<S, E> = (
  state: S,
  dispatch: (event: E) => void
) => Cleanup | void;

/**
 * Work with a state lifetime. Every accepted transition cleans up the old
 * scope and starts the next, including transitions with the same `t`. The
 * state passed to a scope stays constant for that scope's lifetime.
 */
export type MachineScopes<S extends { t: string }, E> = {
  readonly [K in S['t']]?: MachineScope<Extract<S, { t: K }>, E>;
};

export type MachineOptions<S extends { t: string }, E, C = never> = {
  readonly initial: S;
  readonly def: MachineDef<S, E, C>;
  readonly scopes?: MachineScopes<S, E> | undefined;
  /** Execute commands in order after entering and publishing the next state. */
  readonly execute?: ((cmd: C, dispatch: (e: E) => void) => void) | undefined;
  /** Observe every event, including ignored ones, before applying its result. */
  readonly inspect?:
    | ((from: S, e: E, result: Transition<S, C> | 'ignored') => void)
    | undefined;
};

/** A running machine with an explicit lifetime and synchronous state access. */
export type Machine<S, E> = {
  readonly getState: () => S;
  /** Nested dispatches queue until the current transition has completed. */
  readonly dispatch: (event: E) => void;
  /**
   * Subscribe to future accepted transitions, after scope entry and before
   * commands. Read `getState()` for the initial snapshot. Ignored events do
   * not notify subscribers.
   */
  readonly subscribe: (listener: (state: S) => void) => Cleanup;
  /** Clean up once, remove subscriptions, and ignore subsequent dispatches. */
  readonly dispose: Cleanup;
};
