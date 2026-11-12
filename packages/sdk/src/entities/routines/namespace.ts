import type {
  RoutineCheck,
  SuggestOutcome,
  Surface,
} from '../../../generated/scheduled-action/types.gen';
import { unwrap } from '../../utils';
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
 *
 * ### Writing one
 *
 * - Find each item the request names (a channel, person, folder, project, label, tag, agent, database or document) with SDK search, as the user would, paging and refining the search until you find the item itself. The item is the one whose name is exactly the name used, ignoring case and a leading # or @, not one whose name only contains it: "bug-reports" is the channel named bug-reports, never bug-reports-archive. When no item has that name, or several do, ask which one rather than guess.
 * - In code, a trigger watches items through its event filter's `entities`, as references holding the handles the SDK returned, such as `{ type: 'channel', entity: channel }`: never an id, and never an `ids` key. A code step uses an item by its id, in a knob.
 * - Create beforehand only what the routine needs to exist before it runs: when the request asks for something new that the routine then uses by id (a database it adds rows to, a folder it files into, a channel it posts in), create it with the name given and use its id. Create nothing else.
 * - Never do the routine's own work while setting it up; it does its work each time it runs. "Every Monday make a task" makes no task today; "when an email arrives, reply" sends nothing; "post the weekly summary" posts nothing.
 * - In a cron `schedule` (six fields: second minute hour day-of-month month day-of-week), name weekdays MON to SUN: weekday numbers start at 1 = Sunday, so Monday to Friday is `MON-FRI`, never `1-5`.
 * - In code, check the whole routine with `macro.routines.check` before creating it, naming in `created` what you created for it, and fix what it reports until `ok` is true.
 *
 * Events an `events` trigger starts on (`EventName` lists every one):
 *
 * - `channel.created`: a channel you can access is created.
 * - `channel.message_posted`: someone sends a message in a selected channel.
 * - `channel.mentioned`: you are @ mentioned in a selected channel.
 * - `document.created`: a document you can access is created. Tasks have their own trigger.
 * - `document.deleted`: a selected document is deleted.
 * - `task.created`: a task you can access is created.
 * - `task.status_changed`: a task's status changes.
 * - `task.priority_changed`: a task's priority changes.
 * - `task.property_changed`: any property on a task changes, such as its assignees, due date, project or effort, including status and priority.
 * - `email.message_received`: new mail arrives in your inbox. Excludes spam, trash, drafts and historical imports.
 * - `call.started`: a call you start begins. The routine gets the call and who has joined so far.
 * - `call.ended`: a call you joined ends. The routine gets the call's participants and transcript.
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
   *
   * @readonly
   */
  async check(
    options: RoutineOptions,
    extra?: { created?: CreatedEntity[] },
  ): Promise<RoutineCheck> {
    return unwrap(
      await this.client.scheduledAction.checkScheduledAction({
        body: {
          routine: {
            ...routineBody(options),
            enabled: options.enabled ?? true,
          },
          created: (extra?.created ?? []).map((item) => ({
            entityType: item.entityType,
            entityId: item.id,
          })),
        },
      }),
    );
  }

  /**
   * Suggest a routine to the user. Only a routine suggestion session may
   * call this; any other session gets a 403. Suggest a catalog routine by
   * `key` with `knobs`, or a `routine` the catalog lacks, written as `check`
   * takes it and checked the same way. `surfaces` are the parts of the app
   * whose sidebar shows it, best fit first; `reason` is one line, shown to
   * the user, naming no one's email address; `keepProbability` is the
   * chance, from 0 to 1, that the user keeps it on. Returns whether it was
   * kept (`ok`) and, when not, the `problems` to fix before suggesting it
   * again.
   *
   * @example
   * const outcome = await macro.routines.suggest({
   *   kind: 'catalog',
   *   key: 'inbox',
   *   knobs: {},
   *   reason: 'Most of your mail is supplier updates',
   *   surfaces: ['email'],
   *   keepProbability: 0.6,
   * });
   * if (!outcome.ok) return outcome.problems;
   *
   * @write
   */
  async suggest(
    suggestion:
      | {
          kind: 'catalog';
          key: string;
          knobs?: Record<string, unknown>;
          reason: string;
          surfaces: Surface[];
          keepProbability: number;
        }
      | {
          kind: 'routine';
          routine: RoutineOptions;
          created?: CreatedEntity[];
          reason: string;
          surfaces: Surface[];
          keepProbability: number;
        },
  ): Promise<SuggestOutcome> {
    const body =
      suggestion.kind === 'catalog'
        ? { ...suggestion, knobs: suggestion.knobs ?? {} }
        : {
            kind: suggestion.kind,
            routine: {
              ...routineBody(suggestion.routine),
              enabled: false,
            },
            created: (suggestion.created ?? []).map((item) => ({
              entityType: item.entityType,
              entityId: item.id,
            })),
            reason: suggestion.reason,
            surfaces: suggestion.surfaces,
            keepProbability: suggestion.keepProbability,
          };
    return unwrap(await this.client.scheduledAction.suggestRoutine({ body }));
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
