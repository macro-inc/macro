import type { RunningTimer } from '../../../generated/storage/types.gen';
import { MacroError, MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { rejectUnknownOptions } from '../../utils/options';
import { MacroEntity } from '../entity';
import { Task } from '../tasks/task';
import { unwrapTime } from './errors';
import { TimeEntry } from './time-entry';

/** How `timer.stop` saves a timer. */
export interface StopTimerOptions {
  /**
   * IANA time zone (`Europe/Paris`) whose calendar day the entry takes, from
   * the timer's start; UTC when omitted.
   */
  timeZone?: string;
  /**
   * When the person stopped working, for a timer past 8 hours: the entry runs
   * from the start to this instant instead of to now.
   */
  endedAt?: Date;
  /** Log all the time until now, for a timer past 8 hours; at most 24 hours can be logged. */
  logAll?: boolean;
}

/**
 * Your running timer on a task. Stopping it saves a time entry from its start
 * to now; discarding it saves nothing. A person has at most one.
 */
export class Timer extends MacroEntity<RunningTimer> {
  /** A handle to your running timer by id. Details load on first access. */
  static byId(client: MacroClient, id: string): Timer {
    return new Timer(client, id);
  }

  /** @internal A timer the API returned. */
  static from(client: MacroClient, record: RunningTimer): Timer {
    return new Timer(client, record.id, record);
  }

  /** @internal The caller's running timer, if any. */
  static async running(client: MacroClient): Promise<Timer | undefined> {
    const { timer } = unwrap(await client.storage.getTimer());
    return timer ? Timer.from(client, timer) : undefined;
  }

  protected async fetch(): Promise<RunningTimer> {
    const { timer } = unwrap(await this.client.storage.getTimer());
    if (timer?.id !== this.id)
      throw new MacroNotFoundError(`Timer ${this.id} is no longer running.`);
    return timer;
  }

  /** The task being timed. */
  readonly task = this.mappedField('taskId', (id) =>
    Task.byId(this.client, id),
  );

  /** When it started, by the server's clock (RFC 3339). */
  readonly startedAt = this.field('startedAt');

  /**
   * Stop the timer and log its time on the task as an entry, returned; one
   * that was discarded returns `undefined`. Past 8 hours it throws
   * `TimerOverLimitError` and saves nothing: ask the user when they stopped
   * and pass `endedAt`, or pass `logAll: true`.
   *
   * @write
   * @idempotent
   */
  async stop(opts: StopTimerOptions = {}): Promise<TimeEntry | undefined> {
    if (typeof opts !== 'object' || opts === null)
      throw new MacroError(
        'timer.stop takes an options object, { timeZone, endedAt, logAll }.',
      );
    rejectUnknownOptions('timer.stop', opts, {
      timeZone: true,
      endedAt: true,
      logAll: true,
    });
    const { logged } = unwrapTime(
      await this.client.storage.stopTimer({
        body: {
          timerId: this.id,
          timeZone: opts.timeZone,
          endedAt: opts.endedAt?.toISOString(),
          logAll: opts.logAll,
        },
      }),
      (record) => Timer.from(this.client, record),
    );
    this.detail.clear();
    return logged ? TimeEntry.from(this.client, logged.entry) : undefined;
  }

  /**
   * Throw the timer away without logging any time.
   *
   * @destructive
   * @idempotent
   */
  async discard(): Promise<void> {
    unwrapTime(
      await this.client.storage.discardTimer({ body: { timerId: this.id } }),
    );
    this.detail.clear();
  }
}
