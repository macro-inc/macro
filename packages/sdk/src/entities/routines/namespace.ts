import type {
  RoutineCheck,
  RoutineSuggestionCard,
  SuggestOutcome,
  Surface,
} from '../../../generated/scheduled-action/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { MacroEntityType } from '../entity';
import { Routine, type RoutineOptions, routineBody } from './routine';
import { RoutineSuggestion } from './suggestion';

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
 * - A routine created by a routine's run, from its code or its Ask AI step, is that routine's sub-routine: it is listed under it, pauses and is deleted with it, and `list()` leaves it out unless asked. A routine has at most 50 active sub-routines (one-time ones that have run don't count); creating another is refused. When a run may create the same routine again, pass a `key` so the second create updates the first instead of adding a duplicate.
 *
 * ### Writing one
 *
 * - Find every item the request names (a channel, person, folder, project, label, tag, agent, database or document) with one `macro.search.names` call for all of them, before any other search: it looks in every kind at once. The item is the match marked `exact`, whose name is exactly the name used, ignoring case and a leading # or @, not one whose name only contains it: "bug-reports" is the channel named bug-reports, never bug-reports-archive. When no match is exact, or several are and the request doesn't say which kind it means, ask which one rather than guess. A kind in `unavailable` wasn't checked: look for the item there with SDK search before saying it doesn't exist.
 * - In code, a trigger watches items through its event filter's `entities`, as references holding the handles the SDK returned, such as `{ type: 'channel', entity: channel }`: never an id, and never an `ids` key.
 * - A code step takes each item the request names from a knob, never from a name or id written into its code. The knob holds the item's name, which the step looks up when it runs with `macro.search.names([{ name: knobs.x, kinds: [its kind] }])`, taking the one exact match and throwing an error that names the knob when there is none. It holds an id only for an item made for the routine, such as the database it writes to.
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
   * Create a routine from `steps`: code steps and at most one Ask AI
   * (`agent`) step. The older single agent task (`prompt`, with `model`,
   * `agent`, or both) still saves and runs as one Ask AI step; write new
   * routines as steps. Set `dangerouslyOperateAsUser` only when the user
   * explicitly asked for it to act, send or post as them. To check on
   * something later, such as a spawned session or a long job, create a
   * routine instead of waiting in a program. A cron `schedule` has 6 fields
   * (second minute hour day-of-month month day-of-week) or 7 with a year; a
   * 7-field schedule that names one date runs once. A code step's `source`
   * exports `async function main({ macro, run, trigger, steps, knobs })` and
   * is type-checked against this SDK when saved. A rejected routine throws a
   * `MacroApiError` whose message says what the server refused, including
   * type-check errors.
   *
   * Inside a routine's run, the new routine is that routine's sub-routine
   * ({@link Routine.parent}). Pass `key` there to name it: creating with the
   * same key again updates that sub-routine instead of adding another, so a
   * run that repeats is safe. Without a key every create adds a routine, and
   * the 51st active sub-routine is refused. Outside a routine's run a key is
   * rejected.
   *
   * @example
   * // Every ten minutes, in New York time.
   * const routine = await macro.routines.create({
   *   name: 'Check the import',
   *   trigger: {
   *     type: 'cron',
   *     schedule: '0 0/10 * * * *',
   *     timezone: 'America/New_York',
   *   },
   *   steps: [
   *     {
   *       type: 'agent',
   *       instructions: 'Read the import task and post its status in the channel.',
   *       model: 'anthropic/claude-sonnet-5-5',
   *     },
   *   ],
   * });
   * // Once, at 14:30 on 3 November 2027.
   * await macro.routines.create({
   *   name: 'Follow up on the review',
   *   trigger: { type: 'cron', schedule: '0 30 14 3 11 * 2027', timezone: 'UTC' },
   *   steps: [
   *     {
   *       type: 'agent',
   *       instructions: 'Read the review session and summarize its outcome.',
   *       model: 'anthropic/claude-sonnet-5-5',
   *     },
   *   ],
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
   *       knobs: [{ type: 'text', name: 'channel', label: 'Channel to post in', value: 'general' }],
   *       sentence: 'Post Hello in {channel}.',
   *       source: `export async function main({ macro, knobs }: StepContext) {
   *   const [{ matches }] = (await macro.search.names([{ name: knobs.channel, kinds: ['channel'] }])).results;
   *   const match = matches.find((m) => m.exact && m.type === 'channel');
   *   if (match?.type !== 'channel') throw new Error('There is no channel named ' + knobs.channel + '. Change the channel to post in.');
   *   await match.entity.send('Hello');
   * }`,
   *     },
   *   ],
   *   dangerouslyOperateAsUser: true,
   * });
   * // In a routine's code step: one follow-up per task, however often it runs.
   * await macro.routines.create(
   *   {
   *     name: `Check on ${taskName}`,
   *     trigger: { type: 'once', at: tomorrow },
   *     steps: [
   *       {
   *         type: 'agent',
   *         instructions: `Read task ${taskId} and post its status in the channel.`,
   *         model: 'anthropic/claude-sonnet-5-5',
   *       },
   *     ],
   *   },
   *   { key: `check-${taskId}` },
   * );
   *
   * @write
   */
  async create(
    options: RoutineOptions,
    extra?: {
      /**
       * Names the routine among its parent's sub-routines, up to 200
       * characters. Only inside a routine's run.
       */
      key?: string;
    },
  ): Promise<Routine> {
    return Routine.from(
      this.client,
      unwrap(
        await this.client.scheduledAction.createScheduledAction({
          body: { ...routineBody(options), enabled: options.enabled ?? true },
          query: { key: extra?.key },
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
   * Suggest a routine to the user. Only a routines generation session may
   * call this; any other session gets a 403. Suggest a catalog routine by
   * `key` with `knobs`, or a `routine` the catalog lacks, written as `check`
   * takes it and checked the same way. `surfaces` are the parts of the app
   * whose sidebar shows it, best fit first; `reason` is one line, shown to
   * the user, naming no one's email address; `keepProbability` is the
   * chance, from 0 to 1, that the user keeps it on. A drafted `routine`
   * also shows in the user's Suggestions feed, as its `card` says; a catalog
   * routine takes no `card`. Returns whether it was kept (`ok`) and, when
   * not, the `problems` to fix before suggesting it again.
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
          /** How it shows in the user's Suggestions feed: a short title, an importance from 0 to 100, and fitting categories. */
          card: RoutineSuggestionCard;
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
            card: suggestion.card,
          };
    return unwrap(await this.client.scheduledAction.suggestRoutine({ body }));
  }

  /**
   * Every routine suggestion AI made for the user, open or not, and how
   * many more this session may hand back. Only a routines generation
   * session may call this. Retire with `suggestion.retire(reason)` what no
   * longer fits; suggestions are never rewritten.
   *
   * @mcp-exclude only a routines generation session may call it
   */
  async review(): Promise<{
    suggestions: RoutineSuggestion[];
    keptLeft: number;
  }> {
    const review = unwrap(
      await this.client.scheduledAction.reviewRoutineSuggestions(),
    );
    return {
      suggestions: review.suggestions.map((record) =>
        RoutineSuggestion.from(this.client, record),
      ),
      keptLeft: review.keptLeft,
    };
  }

  /**
   * List the user's top-level routines, as their Routines list shows them:
   * sub-routines, which other routines' runs created, are left out. Pass
   * `parent` for one routine's sub-routines (its newest finished one-time
   * ones included), or `includeChildren` to add active sub-routines; each
   * sub-routine names its {@link Routine.parent} and
   * {@link Routine.createdByRun}. `includeEvents` adds event-triggered
   * routines.
   *
   * @readonly
   */
  async list(options?: {
    includeEvents?: boolean;
    includeChildren?: boolean;
    parent?: Routine;
  }): Promise<Routine[]> {
    return unwrap(
      await this.client.scheduledAction.listScheduledActions({
        query: {
          include_events: options?.includeEvents,
          include_children: options?.includeChildren,
          parent: options?.parent?.id,
        },
      }),
    ).map((record) => Routine.from(this.client, record));
  }
}
