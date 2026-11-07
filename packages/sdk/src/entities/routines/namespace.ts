import { unwrap } from '../../utils';
import type { RoutineCheck } from '../../../generated/scheduled-action/types.gen';
import type { MacroClient } from '../../utils/client';
import type { MacroEntityType } from '../entity';
import { Routine, type RoutineOptions, routineBody } from './routine';

/** Something created for a routine to use: any handle with an entity type, such as a `Database`. */
export interface CreatedEntity {
  readonly id: string;
  readonly entityType: MacroEntityType;
}

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
   * Create a routine: one agent task (`prompt`, with `model`, `agent`, or
   * both), or code and Ask AI `steps`. Set `dangerouslyOperateAsUser` only
   * when the user explicitly asked for it to act, send or post as them. To
   * check on something later, such as a spawned session or a long job, create
   * a routine instead of waiting in a program. A cron `schedule` has 6 fields
   * (second minute hour day-of-month month day-of-week) or 7 with a year; a
   * 7-field schedule that names one date runs once. A code step's `source`
   * exports `async function main({ macro, run, trigger, steps, knobs })` and
   * is type-checked against this SDK when saved. A rejected routine throws a
   * `MacroApiError` whose message says what the server refused, including
   * type-check errors.
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
   * // A code step that posts in a channel, disabled until turned on. The
   * // user asked for the post to come from them.
   * await macro.routines.create({
   *   name: 'Say hello',
   *   trigger: { type: 'once', at: '2027-11-03T14:30:00Z' },
   *   enabled: false,
   *   steps: [
   *     {
   *       type: 'code',
   *       title: 'Post hello',
   *       source: `export async function main({ macro }: StepContext) {
   *   await macro.channels.byId('<channel id>').send('Hello');
   * }`,
   *     },
   *   ],
   *   dangerouslyOperateAsUser: true,
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

  /**
   * Check a routine without saving it: the checks `create` makes, including
   * type-checking its code steps, with nothing saved. Returns whether it
   * would save (`ok`), what would stop it (`problems`), the code steps that
   * don't type-check (`steps`, by place among the steps) and the routine as
   * it would be stored. Check before creating, and fix what it reports.
   * `created` names what you created for the routine to use, such as the
   * database it writes to, so whoever reviews a drafted routine knows it
   * exists.
   *
   * @example
   * const check = await macro.routines.check({
   *   name: 'Say hello',
   *   trigger: { type: 'once', at: '2027-11-03T14:30:00Z' },
   *   steps: [{ type: 'code', title: 'Post hello', source }],
   * });
   * if (!check.ok) return { problems: check.problems, steps: check.steps };
   */
  async check(
    options: RoutineOptions,
    extra?: { created?: CreatedEntity[] },
  ): Promise<RoutineCheck> {
    return unwrap(
      await this.client.scheduledAction.checkScheduledAction({
        body: {
          routine: { ...routineBody(options), enabled: options.enabled ?? true },
          created: (extra?.created ?? []).map((item) => ({
            entityType: item.entityType,
            entityId: item.id,
          })),
        },
      }),
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
