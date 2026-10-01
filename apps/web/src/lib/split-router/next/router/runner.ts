import {
  createMachine,
  type Machine,
  type MachineScopes,
} from '@macro-inc/machine';
import { untrack } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { match } from 'ts-pattern';
import type { Entry, PaneId } from '../routes/types';
import { isPromise, type MaybePromise, mapMaybe } from '../utils';
import {
  IDLE,
  type Phase,
  type Command as RunCommand,
  type Event as RunEvent,
  type Running,
  type State as RunState,
  runDef,
} from './run';
import {
  CANCELLED_RESULT,
  type PaneTarget,
  type Navigation,
  type NavigationCause,
  type NavigationResult,
} from './types';
import {
  type Command as GateCommand,
  type Event as GateEvent,
  type State as GateState,
  urlGateDef,
} from './url-gate';

/** An in-flight navigation as it affects one pane. */
export type PendingNavigation = {
  phase: Phase;
  cause: NavigationCause;
  pane: PaneId;
  from?: Entry;
  to: Entry;
};

type InFlight = {
  phase: Phase;
  cause: NavigationCause;
  targets: readonly PaneTarget[];
};

type Run = Machine<RunState, RunEvent>;

type PaneRun = { pane: PaneId; machine: Run };

type Settle = (result: NavigationResult) => void;

const URL_KEY = '@url';

/** What each pane, and the URL navigation run, has in flight. */
function createInFlight() {
  const [inFlight, setInFlight] = createStore<
    Record<string, InFlight | undefined>
  >({});

  const clear = (key: string) => {
    if (!inFlight[key]) return;

    setInFlight(
      produce((draft) => {
        delete draft[key];
      })
    );
  };

  /** Publishes a run once a phase waits on async work; runs that finish at once never show. */
  const show = (key: string, state: Running) => {
    const { navigation } = state;

    setInFlight(key, {
      phase: state.t,
      cause: navigation.cause,
      targets: navigation.targets,
    });
  };

  /** Keeps a published run up to date as it moves on. */
  const follow = (key: string, state: RunState) => {
    const published = untrack(() => inFlight[key]) !== undefined;
    if (!published) return;

    if (state.t === 'idle') {
      clear(key);
      return;
    }

    show(key, state);
  };

  const pendingFrom = (
    key: string,
    pane: PaneId
  ): PendingNavigation | undefined => {
    const record = inFlight[key];
    if (!record) return;

    const target = record.targets.find((candidate) => candidate.pane === pane);
    if (!target) return;

    const { phase, cause } = record;

    return { phase, cause, pane, from: target.from, to: target.to };
  };

  /** The in-flight navigation that affects `pane`, from the pane itself or the URL. */
  const pending = (pane: PaneId) =>
    pendingFrom(pane, pane) ?? pendingFrom(URL_KEY, pane);

  return { show, follow, pending };
}

function runAll(actions: readonly (() => void)[]) {
  for (const action of actions) {
    action();
  }
}

export type Runner = ReturnType<typeof createRunner>;

/**
 * Runs navigations: a run machine (`run.ts`) per pane and one for URL
 * navigations, with the URL gate (`url-gate.ts`) deciding when pane
 * actions may run. It never looks at what a navigation does; each one
 * applies itself.
 */
export function createRunner(options: {
  /** Phase work for a run; `waiting` hears when a phase goes async. */
  phases(waiting: (state: Running) => void): MachineScopes<RunState, RunEvent>;
  /** Panes still open; runs of the others are dropped once idle. */
  live(): readonly PaneId[];
}) {
  const inFlight = createInFlight();
  const settlers = new WeakMap<Navigation, Settle>();
  const outstanding: Promise<unknown>[] = [];
  const waiters: (() => void)[] = [];
  const paneRuns: PaneRun[] = [];
  let committing = 0;
  let disposed = false;

  const track = async (promise: Promise<unknown>) => {
    outstanding.push(promise);
    await promise;
    outstanding.splice(outstanding.indexOf(promise), 1);
  };

  /** Starts `navigation`; one that never waits has settled by the time `start` returns. */
  const run = (
    navigation: Navigation,
    begin: () => void
  ): MaybePromise<NavigationResult> => {
    const deferred = Promise.withResolvers<NavigationResult>();
    let result: NavigationResult | undefined;

    settlers.set(navigation, (value) => {
      result = value;
      deferred.resolve(value);
    });
    void track(deferred.promise);
    begin();

    return result ?? deferred.promise;
  };

  const settle = (navigation: Navigation, result: NavigationResult) => {
    const settler = settlers.get(navigation);
    settlers.delete(navigation);
    settler?.(result);
  };

  const isOpen = () => {
    const { t } = gate.getState();
    const gateOpen = t === 'open' || t === 'disposed';

    return gateOpen && committing === 0;
  };

  /** Lets waiting actions run once no commit or URL navigation holds them back. */
  const release = () => {
    if (!isOpen()) return;

    runAll(waiters.splice(0));
  };

  /**
   * Applies one navigation. Actions it sets off, such as a view redirecting
   * as it mounts, wait until it has written the URL. An apply that throws is
   * turned down so the machines keep running.
   */
  const commit = (
    navigation: Navigation,
    entries: readonly Entry[]
  ): NavigationResult => {
    committing += 1;

    try {
      return navigation.apply(entries);
    } catch (error) {
      console.error('Split router could not commit a navigation', error);
      return CANCELLED_RESULT;
    } finally {
      committing -= 1;
      release();
    }
  };

  /** A run whose waiting phases show under `key` in `pending`. */
  const createRun = (
    key: string,
    execute: (command: RunCommand) => void
  ): Run => {
    const scopes = options.phases((state) => inFlight.show(key, state));
    const machine = createMachine<RunState, RunEvent, RunCommand>({
      initial: IDLE,
      def: runDef,
      scopes,
      execute,
    });

    machine.subscribe((state) => inFlight.follow(key, state));

    return machine;
  };

  const findRun = (pane: PaneId) =>
    paneRuns.find((item) => item.pane === pane)?.machine;

  const isFinished = (item: PaneRun, live: readonly PaneId[]) => {
    const stillOpen = live.includes(item.pane);
    const idle = item.machine.getState().t === 'idle';

    return idle && !stillOpen;
  };

  /** Drops the runs of panes that were removed and have nothing in flight. */
  const sweep = () => {
    const live = options.live();
    const finished = paneRuns.filter((item) => isFinished(item, live));

    for (const item of finished) {
      item.machine.dispose();
      paneRuns.splice(paneRuns.indexOf(item), 1);
    }
  };

  const abortPanes = (reason: 'superseded' | 'disposed') => {
    for (const { machine } of [...paneRuns]) {
      machine.dispatch({ t: 'abort', reason });
    }
  };

  const executePaneRun = (command: RunCommand) => {
    match(command)
      .with({ t: 'commit' }, ({ navigation, entries }) =>
        settle(navigation, commit(navigation, entries))
      )
      .with({ t: 'cancel' }, ({ navigation }) =>
        settle(navigation, CANCELLED_RESULT)
      )
      .exhaustive();

    sweep();
  };

  const paneRun = (pane: PaneId): Run => {
    const existing = findRun(pane);
    if (existing) return existing;

    const created = createRun(pane, executePaneRun);
    paneRuns.push({ pane, machine: created });

    return created;
  };

  const abort = (pane: PaneId) => {
    findRun(pane)?.dispatch({ t: 'abort', reason: 'superseded' });
  };

  const commitUrl = (navigation: Navigation, entries: readonly Entry[]) => {
    const result = commit(navigation, entries);
    settle(navigation, result);

    const failed = result.status === 'cancelled';
    if (failed) return 'failed';

    return 'committed';
  };

  const executeUrlRun = (command: RunCommand) => {
    const { navigation } = command;

    const outcome = match(command)
      .with({ t: 'commit' }, ({ entries }) => commitUrl(navigation, entries))
      .with({ t: 'cancel' }, ({ reason }) => {
        settle(navigation, CANCELLED_RESULT);

        return reason;
      })
      .exhaustive();

    gate.dispatch({ t: 'settled', navigation, outcome });
  };

  const urlRun = createRun(URL_KEY, executeUrlRun);

  const abortUrl = (
    navigation: Navigation,
    reason: 'interrupted' | 'disposed'
  ) => {
    const state = urlRun.getState();
    const running = state.t !== 'idle' && state.navigation === navigation;

    if (running) {
      urlRun.dispatch({ t: 'abort', reason });
      return;
    }

    // Turned away before it ran.
    settle(navigation, CANCELLED_RESULT);
  };

  const revert = (
    navigation: Navigation,
    dispatch: (event: GateEvent) => void
  ) => {
    const landed = navigation.revert?.();

    void mapMaybe(landed, () => dispatch({ t: 'revert-landed' }));
  };

  const executeGate = (
    command: GateCommand,
    dispatch: (event: GateEvent) => void
  ) => {
    match(command)
      .with({ t: 'run' }, ({ navigation }) =>
        urlRun.dispatch({ t: 'navigate', navigation })
      )
      .with({ t: 'abort' }, ({ navigation, reason }) =>
        abortUrl(navigation, reason)
      )
      .with({ t: 'revert' }, ({ navigation }) => revert(navigation, dispatch))
      .with({ t: 'cancel-pane-runs' }, () => abortPanes('superseded'))
      .with({ t: 'opened' }, release)
      .exhaustive();

    sweep();
  };

  const gate = createMachine<GateState, GateEvent, GateCommand>({
    initial: { t: 'open' },
    def: urlGateDef,
    execute: executeGate,
  });

  /**
   * Settles once pane actions may run: no commit is running and no URL
   * navigation could replace the panes. Synchronous when nothing is in the
   * way, including a revert that lands at once.
   */
  const whenIdle = (): MaybePromise<void> => {
    if (isOpen()) return;

    // A running commit ends by itself; only a URL navigation needs to hear that an action waits.
    if (committing === 0) gate.dispatch({ t: 'action' });
    if (isOpen()) return;

    const opened = new Promise<void>((resolve) => waiters.push(resolve));
    void track(opened);

    return opened;
  };

  /**
   * Runs `work` once pane actions may run, or returns `disposed` after
   * `dispose()`. Waking up is no promise: a URL navigation may have started
   * since, so a woken action asks again.
   */
  const act = <T>(
    disposedValue: T,
    work: () => MaybePromise<T>
  ): MaybePromise<T> => {
    const idle = whenIdle();
    if (isPromise(idle)) return mapMaybe(idle, () => act(disposedValue, work));

    if (disposed) return disposedValue;

    return untrack(work);
  };

  return {
    /** Navigates one pane, replacing whatever that pane had in flight. */
    start(pane: PaneId, navigation: Navigation) {
      const begin = () => paneRun(pane).dispatch({ t: 'navigate', navigation });

      return run(navigation, begin);
    },

    /** Starts a URL navigation; `blocking` makes pane actions wait instead of interrupting it. */
    startUrl(navigation: Navigation, blocking: boolean) {
      const begin = () => gate.dispatch({ t: 'start', navigation, blocking });

      return run(navigation, begin);
    },

    /** Applies without guards or middleware. */
    commitNow(navigation: Navigation): NavigationResult {
      const entries = navigation.targets.map((target) => target.to);

      return commit(navigation, entries);
    },

    whenIdle,
    act,
    abort,

    /** The navigation `pane`'s own run has in flight, if any. */
    inFlight(pane: PaneId): Navigation | undefined {
      const state = findRun(pane)?.getState();
      if (!state || state.t === 'idle') return;

      return state.navigation;
    },

    isRunning(pane: PaneId): boolean {
      const machine = findRun(pane);
      if (!machine) return false;

      return machine.getState().t !== 'idle';
    },

    pending: inFlight.pending,

    /** Resolves once nothing is in flight. */
    async settled(): Promise<void> {
      while (outstanding.length > 0) {
        await Promise.all(outstanding);
      }
    },

    /** Cancels everything; waiting actions run and see the runner disposed. */
    dispose(): void {
      disposed = true;
      gate.dispatch({ t: 'dispose' });
      abortPanes('disposed');

      for (const { machine } of paneRuns) {
        machine.dispose();
      }

      paneRuns.length = 0;
      urlRun.dispose();
    },
  };
}
