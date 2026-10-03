import type { MachineDef, Transition } from '@macro-inc/machine';
import { match } from 'ts-pattern';
import type { Entry } from '../routes/types';
import type { CancelReason, Navigation } from './types';

/**
 * One navigation at a time as a state machine: each pane has one, and so do
 * URL navigations. Pure: `runner.ts` does each phase's work and
 * reports it; this module decides what it means.
 *
 * Lifecycle:  idle → guards → middleware → preload → idle
 *
 * A new navigation replaces the one in flight, whatever phase it is in.
 */

export type State =
  | { readonly t: 'idle' }
  | { readonly t: 'guards'; readonly navigation: Navigation }
  | { readonly t: 'middleware'; readonly navigation: Navigation }
  | {
      readonly t: 'preload';
      readonly navigation: Navigation;
      readonly entries: readonly Entry[];
    };

export type Running = Exclude<State, { t: 'idle' }>;

/** A running navigation, named after the work it waits on. */
export type Phase = Running['t'];

export type Event =
  | { readonly t: 'navigate'; readonly navigation: Navigation }
  | {
      readonly t: 'abort';
      readonly reason: 'superseded' | 'interrupted' | 'disposed';
    }
  | { readonly t: 'allowed' }
  | { readonly t: 'refused' }
  /** Middleware settled on these entries, one per target. */
  | { readonly t: 'resolved'; readonly entries: readonly Entry[] }
  | { readonly t: 'middleware-cancelled' }
  | { readonly t: 'preloaded' }
  /** The phase's work threw or rejected. */
  | { readonly t: 'failed' };

export type Command =
  | {
      readonly t: 'commit';
      readonly navigation: Navigation;
      readonly entries: readonly Entry[];
    }
  | {
      readonly t: 'cancel';
      readonly navigation: Navigation;
      readonly reason: CancelReason;
    };

type Result = Transition<State, Command> | undefined;

export const IDLE: State = { t: 'idle' };

const cancel = (navigation: Navigation, reason: CancelReason): Command => ({
  t: 'cancel',
  navigation,
  reason,
});

const toIdle = (command: Command): Result => ({
  state: IDLE,
  commands: [command],
});

/** Rows every phase shares; any other report comes from a phase already left. */
function anyPhase(s: Running, e: Event): Result {
  return match(e)
    .with(
      { t: 'navigate' },
      (e): Result => ({
        state: { t: 'guards', navigation: e.navigation },
        commands: [cancel(s.navigation, 'superseded')],
      })
    )
    .with({ t: 'abort' }, (e) => toIdle(cancel(s.navigation, e.reason)))
    .with({ t: 'failed' }, () => toIdle(cancel(s.navigation, 'failed')))
    .otherwise(() => undefined);
}

function guards(s: Extract<State, { t: 'guards' }>, e: Event): Result {
  if (e.t === 'allowed') {
    return { state: { t: 'middleware', navigation: s.navigation } };
  }

  if (e.t === 'refused') return toIdle(cancel(s.navigation, 'refused'));

  return anyPhase(s, e);
}

function middleware(s: Extract<State, { t: 'middleware' }>, e: Event): Result {
  if (e.t === 'resolved') {
    const { entries } = e;

    return { state: { t: 'preload', navigation: s.navigation, entries } };
  }

  if (e.t === 'middleware-cancelled') {
    return toIdle(cancel(s.navigation, 'cancelled'));
  }

  return anyPhase(s, e);
}

function preload(s: Extract<State, { t: 'preload' }>, e: Event): Result {
  if (e.t === 'preloaded') {
    const { navigation, entries } = s;

    return toIdle({ t: 'commit', navigation, entries });
  }

  return anyPhase(s, e);
}

function idle(e: Event): Result {
  if (e.t !== 'navigate') return;

  return { state: { t: 'guards', navigation: e.navigation } };
}

export const runDef: MachineDef<State, Event, Command> = {
  idle: { on: (_s, e) => idle(e) },
  guards: { on: guards },
  middleware: { on: middleware },
  preload: { on: preload },
};
