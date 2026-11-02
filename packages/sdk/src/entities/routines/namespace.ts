import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Routine, type RoutineOptions, routineBody } from './routine';

/** Scheduled and event-triggered routines. */
export class RoutineNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy routine handle. */
  byId(id: string): Routine {
    return Routine.byId(this.client, id);
  }

  /**
   * Create an agent routine: pass `model` or `agent`, and a five- or six-field
   * cron `schedule` with an IANA `timezone`.
   *
   * Five-field crontab (`min hour day month weekday`, e.g. `0 9 * * *`) and
   * six-field (`sec min hour day month weekday`) are accepted. `agent` is
   * optional when `model` is set. Use cron for recurring checks; a run-once
   * trigger is not available here yet.
   *
   * @example
   * const routine = await macro.routines.create({
   *   name: 'Recurring check',
   *   prompt: 'See whether the investigation finished and comment on the task.',
   *   userPrompt: 'Follow up on the investigation.',
   *   model: 'claude-sonnet-4-6',
   *   trigger: {
   *     type: 'cron',
   *     schedule: '0 9 * * *',
   *     timezone: 'America/New_York',
   *   },
   * });
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

  /** List routines, optionally including event triggers. */
  async list(options?: { includeEvents?: boolean }): Promise<Routine[]> {
    return unwrap(
      await this.client.scheduledAction.listScheduledActions({
        query: { include_events: options?.includeEvents },
      }),
    ).map((record) => Routine.from(this.client, record));
  }
}
