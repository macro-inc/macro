import {
  createBrowserOfflineSignal,
  deviceLooksOffline,
} from '@core/util/connectivity';
import type { Client } from '@urql/core';
import { err } from 'neverthrow';
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
  const offline = () => browserOffline() || deviceLooksOffline();

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
  const now = () => deviceNow() + offset();

  refreshOnTimeTrackingChanges(
    async (change) => {
      if (change.timer && dependencies.enabled()) await query.refetch();
    },
    async () => {
      if (dependencies.enabled()) await query.refetch();
    }
  );

  const [busy, setBusy] = createSignal(false);
  async function write<T>(
    run: (client: Client) => Promise<TimeWriteResult<T>>
  ): Promise<TimeWriteResult<T>> {
    if (offline()) return err(OFFLINE);
    setBusy(true);
    try {
      return await run(dependencies.client());
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
    start: (args: { taskId: string; startedAt?: string }) =>
      write((client) => startTimer(args, { client })),
    stop: (args: { timerId: string; endedAt?: string; logAll?: boolean }) =>
      write((client) => stopTimer(args, { client })),
    discard: (timerId: string) =>
      write((client) => discardTimer({ timerId }, { client })),
  };
}

export type RunningTimerState = ReturnType<typeof createRunningTimer>;
