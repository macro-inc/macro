import type { MacroClient } from '../../utils/client';
import {
  readTimeExport,
  readTimeSummary,
  type TimeExport,
  type TimePeriodOptions,
  type TimeScopeOptions,
  type TimeSummary,
  type TimeSummaryOptions,
} from './report';
import { Timer } from './timer';

/**
 * Time logged on tasks. Log and read it on the task (`task.logTime`,
 * `task.timeEntries`, `task.timeLogged`, `task.startTimer`); this namespace
 * reads your running timer and adds up your own or your team's time over a
 * period. A project's time is on the project (`initiative.timeSummary`).
 *
 * @agent
 * Log time as the user only: there is no logging for someone else. Logging or
 * starting a timer needs edit access to the task. An entry is at most 24 hours
 * and its `date` is the day in the user's own calendar, so pass it whenever
 * their day can differ from UTC's. Only an entry's author can edit or remove
 * it (`NotTimeEntryAuthorError` otherwise); don't request access for that.
 * A timer past 8 hours is refused with `TimerOverLimitError` until the user
 * says when they stopped (`timer.stop({ endedAt })`), to log it all
 * (`logAll: true`, up to 24 hours) or to discard it. Starting a timer stops
 * and saves any timer already running, even on the same task, so read
 * `macro.time.timer()` before starting one. The task's Time logged property
 * is the sum of its entries and cannot be set directly. A 404 "time tracking
 * not found" when logging, starting or stopping means time tracking is not
 * turned on for this user yet: the task exists, so tell them and don't retry.
 * Totals and exports count only tasks the user can see, out of the Trash, so
 * a teammate's time on a task the user cannot see is left out; say so when
 * the user asks about someone's whole week. Days are the loggers' own
 * calendar days: pass `from` and `to` as the user's week or month. A summary
 * with `complete: false` stopped at 5,000 tasks; an export with it stopped
 * at 10,000 entries: offer a shorter period.
 */
export class TimeNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * Your running timer, or `undefined` when none is running.
   *
   * @readonly
   */
  timer(): Promise<Timer | undefined> {
    return Timer.running(this.client);
  }

  /**
   * Your own (`scope: 'mine'`) or your team's (`scope: 'team'`) time over a
   * period of at most 366 days, grouped by person, task or day, each group
   * optionally split by `thenBy`; only tasks you can see count.
   *
   * @example
   * ```ts
   * // This week's timesheet: tasks down the side, days across.
   * const week = await macro.time.summary({
   *   scope: 'mine',
   *   from: '2026-11-23',
   *   to: '2026-11-29',
   *   groupBy: 'task',
   *   thenBy: 'day',
   * });
   * ```
   *
   * @readonly
   */
  summary(opts: TimeSummaryOptions & TimeScopeOptions): Promise<TimeSummary> {
    return readTimeSummary(
      this.client,
      'macro.time.summary',
      { scope: opts?.scope },
      opts,
    );
  }

  /**
   * Your own (`scope: 'mine'`) or your team's (`scope: 'team'`) entries over a
   * period of at most 366 days as CSV text, at most 10,000 entries; only
   * tasks you can see count.
   *
   * @readonly
   */
  exportCsv(opts: TimePeriodOptions & TimeScopeOptions): Promise<TimeExport> {
    return readTimeExport(
      this.client,
      'macro.time.exportCsv',
      { scope: opts?.scope },
      opts,
    );
  }
}
