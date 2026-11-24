import {
  createBrowserOfflineSignal,
  deviceLooksOffline,
} from '@core/util/connectivity';
import type {
  StartTimerMutation,
  StopTimerMutation,
} from '@service-storage/graphql/generated/graphql';
import type { Client } from '@urql/core';
import { err, ok } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { elapsedSeconds, serverOffset } from '../core/timer-clock';
import { refreshOnTimeTrackingChanges } from '../queries/time-tracking-changes';
import {
  createRunningTimerQuery,
  discardTimer,
  type RunningTimer,
  startTimer,
  stopTimer,
} from '../queries/timer';
import type { TimeWriteResult } from '../queries/write-result';

export type RunningTimerDependencies = {
  client: Accessor<Client>;
  /** Whether time tracking is on for this person. */
  enabled: Accessor<boolean>;
};

const OFFLINE = {
  kind: 'refused',
  code: 'OFFLINE',
  message: 'Timer changes need a connection',
} as const;

const BUSY = {
  kind: 'refused',
  code: 'BUSY',
  message: 'Another timer change is in progress',
} as const;

type StartArgs = { taskId: string; startedAt?: string };
type StopArgs = { timerId: string; endedAt?: string; logAll?: boolean };

/** The timer writes, for use inside one exclusive change. */
export type TimerOps = {
  start: (
    args: StartArgs
  ) => Promise<TimeWriteResult<StartTimerMutation['startTimer']>>;
  stop: (
    args: StopArgs
  ) => Promise<TimeWriteResult<StopTimerMutation['stopTimer']>>;
  discard: (timerId: string) => Promise<TimeWriteResult<null>>;
};

/**
 * The person's one running timer, shared by every surface that shows it.
 * Its count runs on this device's clock, corrected by the server's, and
 * ticks once a second only while a timer runs. Timer writes are not queued:
 * offline they are refused, since the server's clock decides start and stop.
 */
export function createRunningTimer(dependencies: RunningTimerDependencies) {
  const query = createRunningTimerQuery(
    dependencies.enabled,
    dependencies.client
  );
  const browserOffline = createBrowserOfflineSignal();
  // The browser's events only prompt a fresh look; the native monitor decides
  // when it knows, as deviceLooksOffline does.
  const offline = () => {
    browserOffline();
    return deviceLooksOffline();
  };

  const [offset, setOffset] = createSignal(0);
  createEffect(
    on([query.serverNow, query.fresh], ([serverNow, fresh]) => {
      if (serverNow && fresh) setOffset(serverOffset(serverNow, Date.now()));
    })
  );

  const timerId = createMemo(() => query.timer()?.id);
  const [deviceNow, setDeviceNow] = createSignal(Date.now());
  createEffect(() => {
    if (!timerId()) return;
    setDeviceNow(Date.now());
    const tick = setInterval(() => setDeviceNow(Date.now()), 1000);
    onCleanup(() => clearInterval(tick));
  });
  // The tick only makes a running count redraw; with no timer running the
  // device clock is still read fresh, so a stop time chosen then is current.
  const now = () => {
    deviceNow();
    return Date.now() + offset();
  };

  refreshOnTimeTrackingChanges(
    async (change) => {
      if (change.timer && dependencies.enabled()) await query.refetch();
    },
    async () => {
      if (dependencies.enabled()) await query.refetch();
    }
  );

  /**
   * A write that got no answer may still have landed, and its push may be
   * lost with it: read what the server holds, and count the write done when
   * the server holds what it asked for. Done this way it has no reply to
   * show (`data` is undefined). The write itself is never resent, since a
   * second start would stop and save the first.
   */
  async function settle<T>(
    result: TimeWriteResult<T>,
    landed: (timer: RunningTimer | undefined) => boolean
  ): Promise<TimeWriteResult<T>> {
    if (result.isOk() || result.error.kind !== 'failed') return result;
    const reread = await query.refetch();
    if (reread.error || !landed(query.timer())) return result;
    return ok({ kind: 'committed', data: undefined });
  }

  const ops: TimerOps = {
    start: async (args) =>
      settle(
        await startTimer(args, { client: dependencies.client() }),
        (timer) =>
          timer?.taskId === args.taskId &&
          (!args.startedAt ||
            Date.parse(timer.startedAt) === Date.parse(args.startedAt))
      ),
    stop: async (args) =>
      settle(
        await stopTimer(args, { client: dependencies.client() }),
        (timer) => timer?.id !== args.timerId
      ),
    discard: async (timerId) =>
      settle(
        await discardTimer({ timerId }, { client: dependencies.client() }),
        (timer) => timer?.id !== timerId
      ),
  };

  // One timer change at a time: a second one while another is in flight is
  // refused, so a double press or a press during Undo sends nothing.
  const [busy, setBusy] = createSignal(false);
  async function exclusive<T>(
    run: (timerOps: TimerOps) => Promise<TimeWriteResult<T>>
  ): Promise<TimeWriteResult<T>> {
    if (offline()) return err(OFFLINE);
    if (busy()) return err(BUSY);
    setBusy(true);
    try {
      return await run(ops);
    } finally {
      setBusy(false);
    }
  }

  return {
    timer: query.timer,
    /** Seconds the running timer has run, 0 when none runs. */
    seconds: () => {
      const timer = query.timer();
      return timer ? elapsedSeconds(timer.startedAt, now()) : 0;
    },
    /** The server's current time, as this device best knows it, in ms. */
    now,
    pending: query.pending,
    /** A timer write is in flight. */
    busy,
    /** Timer writes need a connection. */
    offline,
    start: (args: StartArgs) => exclusive((timerOps) => timerOps.start(args)),
    stop: (args: StopArgs) => exclusive((timerOps) => timerOps.stop(args)),
    discard: (timerId: string) =>
      exclusive((timerOps) => timerOps.discard(timerId)),
    /** Several timer changes as one: no other timer change runs between them. */
    exclusive,
  };
}

export type RunningTimerState = ReturnType<typeof createRunningTimer>;
