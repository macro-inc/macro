import type { MachineDef, Transition } from './create-machine';

/**
 * Pure helpers for exercising a `MachineDef` as values. No Solid, no owner,
 * no timers — importable from any test or from `domain/` code.
 *
 * These do not run scopes or `execute`. Events that a command would have
 * produced in the runner (e.g. a restore succeeding) must be supplied
 * explicitly in the event list; that is the point — the reducer is tested
 * against what it would be told, not against how the world tells it.
 */

/** Apply one event to one state. */
export function step<S extends { t: string }, E, C>(
  def: MachineDef<S, E, C>,
  state: S,
  event: E
): Transition<S, C> | undefined {
  const entry = def[state.t as S['t']];
  const on = entry.on as (s: S, e: E) => Transition<S, C> | undefined;
  return on(state, event);
}

export type SimulationStep<S, E, C> = {
  readonly from: S;
  readonly event: E;
  readonly result: Transition<S, C> | 'ignored';
};

export type Simulation<S, E, C> = {
  readonly state: S;
  /** Every command emitted along the way, in order. */
  readonly commands: readonly C[];
  readonly steps: readonly SimulationStep<S, E, C>[];
};

/** Apply a sequence of events, collecting emitted commands and the per-step trace. */
export function simulate<S extends { t: string }, E, C>(
  def: MachineDef<S, E, C>,
  initial: S,
  events: readonly E[]
): Simulation<S, E, C> {
  let state = initial;
  const commands: C[] = [];
  const steps: SimulationStep<S, E, C>[] = [];

  for (const event of events) {
    const result = step(def, state, event);
    steps.push({ from: state, event, result: result ?? 'ignored' });
    if (result === undefined) continue;
    state = result.state;
    if (result.commands !== undefined) commands.push(...result.commands);
  }

  return { state, commands, steps };
}
