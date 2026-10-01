import type { Cleanup, MachineScopes } from '@macro-inc/machine';
import type { SplitRoutesManifest } from '../routes/manifest';
import { firstChangedDepth } from '../routes/queries';
import type { Entry, PaneId, PreloadIntent } from '../routes/types';
import {
  all,
  CANCELLED,
  type Cancelled,
  isAbortError,
  isPromise,
  type MaybePromise,
  mapMaybe,
  type Outcome,
} from '../utils';
import { withValidState } from './entries';
import {
  type Check,
  checksFor,
  PANE_LEVEL,
  type LeaveGuards,
  runChecks,
} from './leave-guards';
import { runMiddleware, type SplitRouterMiddleware } from './middleware';
import { preloadLocation, withinBudget } from './preload';
import type { Event as RunEvent, Running, State as RunState } from './run';
import type { PaneTarget, Navigation } from './types';

type Report = (event: RunEvent) => void;

/** What one phase's work runs with; the signal aborts when the run leaves the phase. */
type RunContext = { navigation: Navigation; signal: AbortSignal };

/** The work each phase waits on, for any run machine. */
type PhaseScopes = MachineScopes<RunState, RunEvent>;

const PRELOADED: RunEvent = { t: 'preloaded' };

function intentOf(navigation: Navigation): PreloadIntent {
  const { cause } = navigation;
  const fromUrl = cause === 'initial' || cause === 'external';
  if (fromUrl) return cause;

  return 'navigate';
}

function toGuardEvent(allowed: boolean): RunEvent {
  if (allowed) return { t: 'allowed' };

  return { t: 'refused' };
}

function toMiddlewareEvent(entries: Entry[] | Cancelled): RunEvent {
  if (entries === CANCELLED) return { t: 'middleware-cancelled' };

  return { t: 'resolved', entries };
}

/** Does one phase's work and reports its result; leaving the phase aborts it. */
function perform<T>(
  state: Running,
  dispatch: Report,
  work: (context: RunContext) => MaybePromise<T>,
  toEvent: (value: T) => RunEvent,
  waiting: () => void
): Cleanup {
  const controller = new AbortController();
  const context: RunContext = {
    navigation: state.navigation,
    signal: controller.signal,
  };

  const report = (event: RunEvent) => {
    if (!context.signal.aborted) dispatch(event);
  };

  const fail = (error: unknown) => {
    if (isAbortError(error, context.signal)) return;

    console.error('Split router navigation failed', error);
    report({ t: 'failed' });
  };

  const reportLater = async (pending: Promise<T>) => {
    try {
      report(toEvent(await pending));
    } catch (error) {
      fail(error);
    }
  };

  try {
    const result = work(context);

    if (isPromise(result)) {
      waiting();
      void reportLater(result);
    } else {
      report(toEvent(result));
    }
  } catch (error) {
    fail(error);
  }

  return () => controller.abort();
}

/** `waiting` hears when a phase's work goes async, which is when a run counts as pending. */
export function createPhaseScopes(
  options: {
    routes: SplitRoutesManifest;
    middleware: readonly SplitRouterMiddleware[];
    guards: LeaveGuards;
    /** What a pane shows now, which its guards are asked to leave. */
    current(pane: PaneId): Entry | undefined;
    preloadBudgetMs: number;
  },
  waiting: (state: Running) => void
): PhaseScopes {
  const { routes, guards } = options;

  const targetChecks = ({ navigation, signal }: RunContext): Check[] =>
    navigation.targets.flatMap(({ pane, from, to }) => {
      if (!from) return [];

      const depth = firstChangedDepth(routes, from, to);
      if (depth === undefined) return [];

      const context = { pane, from, to, cause: navigation.cause, signal };

      return checksFor(guards.select(pane, depth), context);
    });

  const removalChecks = ({ navigation, signal }: RunContext): Check[] => {
    const removed = navigation.removed ?? [];

    return removed.flatMap((pane) => {
      const from = options.current(pane);
      if (!from) return [];

      const context = { pane, from, cause: navigation.cause, signal };

      return checksFor(guards.select(pane, PANE_LEVEL), context);
    });
  };

  const checkGuards = (context: RunContext) =>
    runChecks([...targetChecks(context), ...removalChecks(context)]);

  const destination = (
    { navigation, signal }: RunContext,
    target: PaneTarget
  ): Outcome<Entry> => {
    if (options.middleware.length === 0) return target.to;

    const resolved = runMiddleware(routes, options.middleware, {
      from: target.from,
      to: target.to,
      cause: navigation.cause,
      externalSearch: navigation.externalSearch,
      signal,
    });

    return mapMaybe(resolved, (entry): Entry | Cancelled => {
      if (entry !== CANCELLED) return withValidState(routes, entry, target.to);

      // An initial load always mounts something, even if middleware cancels it.
      if (navigation.cause === 'initial') return target.to;

      return CANCELLED;
    });
  };

  const resolveDestinations = (context: RunContext) => {
    const destinations = context.navigation.targets.map((target) =>
      destination(context, target)
    );

    return all(destinations);
  };

  const preloadEntries = (
    { navigation, signal }: RunContext,
    entries: readonly Entry[]
  ): MaybePromise<void> => {
    const intent = intentOf(navigation);
    const work = entries.flatMap((entry) => {
      const context = { location: entry.location, intent, signal };

      return preloadLocation(routes, context) ?? [];
    });
    if (work.length === 0) return;

    return withinBudget(Promise.all(work), options.preloadBudgetMs);
  };

  return {
    guards: (s, dispatch) =>
      perform(s, dispatch, checkGuards, toGuardEvent, () => waiting(s)),

    middleware: (s, dispatch) =>
      perform(s, dispatch, resolveDestinations, toMiddlewareEvent, () =>
        waiting(s)
      ),

    preload: (s, dispatch) =>
      perform(
        s,
        dispatch,
        (context) => preloadEntries(context, s.entries),
        () => PRELOADED,
        () => waiting(s)
      ),
  };
}
