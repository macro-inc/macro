import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Routine, type RoutineOptions, routineBody } from './routine';

/**
 * Scheduled and event-triggered routines.
 *
 * @routing Use when the agent should do something later, on a schedule or whenever an event occurs: reminders, recurring reports, checking back on something; not a task with a due date or a meeting.
 *
 * @agent
 * ## Routines
 *
 * - "Remind me", "every Monday", "tomorrow at 9" and "whenever something happens" ask for a routine: work that runs later, as the user, after this conversation ends. A meeting with other people is a calendar event, not a routine.
 * - A routine's run never sees this conversation. Write its instructions to stand alone: what to do, the items involved by id or link, absolute dates, and where to report the result.
 * - Before creating one, look for a routine of the user's that already does this, and update it instead of adding a second.
 */
export class RoutineNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy routine handle. */
  byId(id: string): Routine {
    return Routine.byId(this.client, id);
  }

  /**
   * Create an agent routine. To check on something later, such as a spawned
   * session or a long job, create a routine instead of waiting in a program.
   * Set `model`, `agent`, or both. A cron `schedule` has 6 fields (second
   * minute hour day-of-month month day-of-week) or 7 with a year; a 7-field
   * schedule that names one date runs once. A rejected routine throws a
   * `MacroApiError` whose message says what the server refused.
   *
   * @example
   * // Every ten minutes, in New York time.
   * const routine = await macro.routines.create({
   *   name: 'Check the import',
   *   prompt: 'Read the import task and post its status in the channel.',
   *   userPrompt: 'Check on the import every ten minutes.',
   *   model: 'anthropic/claude-sonnet-5-5',
   *   trigger: {
   *     type: 'cron',
   *     schedule: '0 0/10 * * * *',
   *     timezone: 'America/New_York',
   *   },
   * });
   * // Once, at 14:30 on 3 November 2027.
   * await macro.routines.create({
   *   name: 'Follow up on the review',
   *   prompt: 'Read the review session and summarize its outcome.',
   *   userPrompt: 'Follow up on the review on 3 November 2027.',
   *   model: 'anthropic/claude-sonnet-5-5',
   *   trigger: { type: 'cron', schedule: '0 30 14 3 11 * 2027', timezone: 'UTC' },
   * });
   *
   * @write
   */
  async create(options: RoutineOptions): Promise<Routine> {
    return Routine.from(
      this.client,
      unwrap(
        await this.client.scheduledAction.createScheduledAction({
          body: { ...routineBody(options), enabled: options.enabled ?? true },
        }),
      ),
    );
  }

  /**
   * List routines, optionally including event triggers.
   *
   * @readonly
   */
  async list(options?: { includeEvents?: boolean }): Promise<Routine[]> {
    return unwrap(
      await this.client.scheduledAction.listScheduledActions({
        query: { include_events: options?.includeEvents },
      }),
    ).map((record) => Routine.from(this.client, record));
  }
}
