import type { MachineDef, Transition } from '@macro-inc/machine';
import { match } from 'ts-pattern';
import type { CancelReason, Navigation } from './types';

/**
 * Whether pane actions may run, as a state machine. A URL navigation
 * replaces every pane at once, so actions can't run against panes it is
 * about to replace. Pure: `runner.ts` runs URL navigations and
 * reverts and reports back.
 */

/** How a URL navigation's run ended. */
export type UrlOutcome = CancelReason | 'committed';

export type State =
  | { readonly t: 'open' }
  | {
      readonly t: 'navigating';
      readonly navigation: Navigation;
      readonly blocking: boolean;
      /** URL navigations this one replaced, oldest first; their URLs are still in history. */
      readonly superseded: readonly Navigation[];
    }
  /** URLs being put back one at a time; the first one's revert is in flight. */
  | { readonly t: 'reverting'; readonly queue: readonly Navigation[] }
  | { readonly t: 'disposed' };

export type Event =
  | {
      readonly t: 'start';
      readonly navigation: Navigation;
      readonly blocking: boolean;
    }
  /** Every URL navigation's outcome; only the current one's counts. */
  | {
      readonly t: 'settled';
      readonly navigation: Navigation;
      readonly outcome: UrlOutcome;
    }
  | { readonly t: 'action' }
  | { readonly t: 'revert-landed' }
  | { readonly t: 'dispose' };

export type Command =
  | { readonly t: 'run'; readonly navigation: Navigation }
  | {
      readonly t: 'abort';
      readonly navigation: Navigation;
      readonly reason: 'interrupted' | 'disposed';
    }
  /** Put back the URL `navigation` landed on, then report `revert-landed`. */
  | { readonly t: 'revert'; readonly navigation: Navigation }
  | { readonly t: 'cancel-pane-runs' }
  /** Waiting actions may run. */
  | { readonly t: 'opened' };

type Result = Transition<State, Command> | undefined;
type Navigating = Extract<State, { t: 'navigating' }>;
type Reverting = Extract<State, { t: 'reverting' }>;
type Start = Extract<Event, { t: 'start' }>;
type Settled = Extract<Event, { t: 'settled' }>;

const OPEN: State = { t: 'open' };
const DISPOSED: State = { t: 'disposed' };
const OPENED: Command = { t: 'opened' };

const abort = (
  navigation: Navigation,
  reason: 'interrupted' | 'disposed'
): Command => ({ t: 'abort', navigation, reason });

function run(
  navigation: Navigation,
  blocking: boolean,
  superseded: readonly Navigation[]
): Result {
  return {
    state: { t: 'navigating', navigation, blocking, superseded },
    commands: [{ t: 'cancel-pane-runs' }, { t: 'run', navigation }],
  };
}

/** Put back `s`'s URL, then those of the navigations it replaced, newest first. */
function putBack(s: Navigating, commands: readonly Command[] = []): Result {
  const queue = [s.navigation, ...[...s.superseded].reverse()];

  return {
    state: { t: 'reverting', queue },
    commands: [...commands, { t: 'revert', navigation: s.navigation }],
  };
}

/** A navigation that replaces another inherits its blocking and keeps it to put back later. */
function supersede(s: Navigating, e: Start): Result {
  const blocking = s.blocking || e.blocking;
  const superseded = [...s.superseded, s.navigation];

  return run(e.navigation, blocking, superseded);
}

/** Committing opens the gate; guards or middleware turning it down put its URLs back; a failure does neither. */
function settle(s: Navigating, e: Settled): Result {
  const current = e.navigation === s.navigation;
  if (!current) return;

  return match<UrlOutcome, Result>(e.outcome)
    .with('committed', () => ({ state: OPEN, commands: [OPENED] }))
    .with('refused', 'cancelled', () => putBack(s))
    .with('failed', () => ({ state: OPEN, commands: [OPENED] }))
    .with('superseded', 'interrupted', 'disposed', () => undefined)
    .exhaustive();
}

/** An action waits for a blocking navigation, and otherwise takes over from it. */
function interrupt(s: Navigating): Result {
  if (s.blocking) return;

  return putBack(s, [abort(s.navigation, 'interrupted')]);
}

/** Disposing opens the gate so waiting actions run and see the router disposed. */
function disposeNavigating(s: Navigating): Result {
  return {
    state: DISPOSED,
    commands: [abort(s.navigation, 'disposed'), OPENED],
  };
}

function navigating(s: Navigating, e: Event): Result {
  return match(e)
    .with({ t: 'start' }, (e) => supersede(s, e))
    .with({ t: 'settled' }, (e) => settle(s, e))
    .with({ t: 'action' }, () => interrupt(s))
    .with({ t: 'dispose' }, () => disposeNavigating(s))
    .with({ t: 'revert-landed' }, () => undefined)
    .exhaustive();
}

function revertLanded(s: Reverting): Result {
  const [, ...rest] = s.queue;
  const [next] = rest;
  if (!next) return { state: OPEN, commands: [OPENED] };

  return {
    state: { t: 'reverting', queue: rest },
    commands: [{ t: 'revert', navigation: next }],
  };
}

/**
 * A navigation arriving while URLs are put back is turned away and put back
 * next, before older ones still queued: history is unwound newest first.
 */
function queueRevert(s: Reverting, e: Start): Result {
  const { navigation } = e;
  const [inFlight, ...older] = s.queue;
  const queue = [inFlight!, navigation, ...older];

  return {
    state: { t: 'reverting', queue },
    commands: [abort(navigation, 'interrupted')],
  };
}

function reverting(s: Reverting, e: Event): Result {
  return match(e)
    .with({ t: 'start' }, (e) => queueRevert(s, e))
    .with({ t: 'revert-landed' }, () => revertLanded(s))
    .with(
      { t: 'dispose' },
      (): Result => ({
        state: DISPOSED,
        commands: [OPENED],
      })
    )
    .with({ t: 'action' }, { t: 'settled' }, () => undefined)
    .exhaustive();
}

function open(e: Event): Result {
  return match(e)
    .with({ t: 'start' }, (e) => run(e.navigation, e.blocking, []))
    .with({ t: 'action' }, (): Result => ({ state: OPEN, commands: [OPENED] }))
    .with({ t: 'dispose' }, (): Result => ({ state: DISPOSED }))
    .with({ t: 'settled' }, { t: 'revert-landed' }, () => undefined)
    .exhaustive();
}

function disposed(e: Event): Result {
  return match(e)
    .with(
      { t: 'start' },
      (e): Result => ({
        state: DISPOSED,
        commands: [abort(e.navigation, 'disposed')],
      })
    )
    .with(
      { t: 'action' },
      (): Result => ({
        state: DISPOSED,
        commands: [OPENED],
      })
    )
    .otherwise(() => undefined);
}

export const urlGateDef: MachineDef<State, Event, Command> = {
  open: { on: (_s, e) => open(e) },
  navigating: { on: navigating },
  reverting: { on: reverting },
  disposed: { on: (_s, e) => disposed(e) },
};
