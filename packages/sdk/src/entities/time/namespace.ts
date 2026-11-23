import type { MacroClient } from '../../utils/client';
import { Timer } from './timer';

/**
 * Time logged on tasks. Log and read it on the task (`task.logTime`,
 * `task.timeEntries`, `task.timeLogged`, `task.startTimer`); this namespace
 * reads your running timer.
 *
 * @agent
 * Log time as the user only: there is no logging for someone else. Logging or
 * starting a timer needs edit access to the task. An entry is at most 24 hours
 * and its `date` is the day in the user's own calendar, so pass it whenever
 * their day can differ from UTC's. Only an entry's author can edit or remove
 * it (`NotTimeEntryAuthorError` otherwise); don't request access for that.
 * A timer past 8 hours is refused with `TimerOverLimitError` until the user
 * says when they stopped (`timer.stop({ endedAt })`), to log it all
 * (`logAll: true`) or to discard it. Starting a timer stops and saves one
 * running on another task. The task's Time logged property is the sum of its
 * entries and cannot be set directly.
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
}
