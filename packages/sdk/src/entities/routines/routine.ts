import { match, P } from 'ts-pattern';
import type {
  ActionTrigger,
  AgentMcpServer,
  AgentTask,
  CodeStep,
  EventFilter,
  RoutineKnob,
  RoutineKnobEntityType,
  RoutineModelId,
  RoutineStep,
  RoutineTask,
  RoutineTemplate as RoutineTemplateRecord,
  RoutineTrigger,
  RunVisibility,
  ScheduledActionResponse,
  TemplateVariable,
} from '../../../generated/scheduled-action/types.gen';
import type { EntityAppearance } from '../../../generated/storage/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { AgentSession } from '../agent-sessions/agent-session';
import type { Agent } from '../agents/agent';
import { Chat } from '../chats/chat';
import { Link } from '../email/link';
import { MacroEntity } from '../entity';
import type { EntityReference } from '../reference';
import type { Task } from '../tasks/task';
import { User } from '../users/user';

/** An event selector references resources by typed handles. */
export type RoutineEventFilter = Omit<
  EventFilter,
  'ids' | 'condition' | 'inboxes'
> & {
  /**
   * The items these events are watched on, as references to handles the SDK
   * returned, such as `{ type: 'channel', entity: channel }`; never ids.
   * Omit to match all items.
   */
  entities?: EntityReference[];
  /** Optional yes/no condition on the triggering content. */
  condition?: string;
  /**
   * For `email.message_received` alone: the inboxes whose new mail starts the
   * routine, from `macro.email.links()`. Omit to watch every inbox the owner
   * reads, their own and those shared with them; prefer this to checking the
   * inbox in a code step.
   */
  inboxes?: Link[];
};

/**
 * One schedule, one exact time, or one set of event selectors. A `once`
 * trigger runs a single time at `at` (RFC 3339), within about a second; a time
 * already past runs as soon as the routine is saved. Use it to check back on
 * something later instead of waiting inside a program.
 */
export type SingleRoutineTrigger =
  | Extract<RoutineTrigger, { type: 'cron' }>
  | Extract<RoutineTrigger, { type: 'once' }>
  | { type: 'events'; filters: RoutineEventFilter[] };

/** One or multiple routine triggers. */
export type RoutineTriggerOptions =
  | SingleRoutineTrigger
  | { type: 'multiple'; triggers: SingleRoutineTrigger[] };

function singleTriggerBody(trigger: SingleRoutineTrigger): RoutineTrigger {
  return match(trigger)
    .with({ type: 'cron' }, (value) => value)
    .with({ type: 'once' }, (value) => value)
    .with({ type: 'events' }, (value) => ({
      type: 'events' as const,
      filters: value.filters.map(({ entities, inboxes, ...filter }) => ({
        ...filter,
        ids: entities?.map((entity) => entity.entity.id),
        inboxes: inboxes?.map((inbox) => inbox.id),
      })),
    }))
    .exhaustive();
}

/** An event selector as read back: the inboxes it picked, as handles. */
export type RoutineEventFilterDetail = Omit<EventFilter, 'inboxes'> & {
  /** For `email.message_received` alone: the inboxes it watches. Absent: every one. */
  inboxes?: Link[];
};

/** A single trigger as read back. */
export type SingleRoutineTriggerDetail =
  | Extract<RoutineTrigger, { type: 'cron' }>
  | Extract<RoutineTrigger, { type: 'once' }>
  | { type: 'events'; filters: RoutineEventFilterDetail[] };

/** A routine's triggers as read back. */
export type RoutineTriggerDetail =
  | SingleRoutineTriggerDetail
  | { type: 'multiple'; triggers: SingleRoutineTriggerDetail[] };

function singleTriggerDetail(
  client: MacroClient,
  trigger: RoutineTrigger,
): SingleRoutineTriggerDetail {
  return match(trigger)
    .with({ type: 'events' }, (value) => ({
      type: 'events' as const,
      filters: value.filters.map(({ inboxes, ...filter }) => ({
        ...filter,
        inboxes: inboxes?.map((id) => Link.byId(client, id)),
      })),
    }))
    .otherwise((value) => value);
}

function triggerDetail(
  client: MacroClient,
  trigger: ActionTrigger,
): RoutineTriggerDetail {
  return trigger.type === 'multiple'
    ? {
        type: 'multiple',
        triggers: trigger.triggers.map((single) =>
          singleTriggerDetail(client, single),
        ),
      }
    : singleTriggerDetail(client, trigger);
}

function triggerBody(trigger: RoutineTriggerOptions): ActionTrigger {
  return match(trigger)
    .with({ type: 'multiple' }, (value) => ({
      type: 'multiple' as const,
      triggers: value.triggers.map(singleTriggerBody),
    }))
    .with({ type: 'cron' }, singleTriggerBody)
    .with({ type: 'once' }, singleTriggerBody)
    .with({ type: 'events' }, singleTriggerBody)
    .exhaustive();
}

/**
 * The item an entity knob holds, as a reference to the handle the SDK
 * returned: an {@link EntityReference} of a kind a knob names, or a task,
 * which references call a document.
 */
export type RoutineKnobItem =
  | Extract<EntityReference, { type: RoutineKnobEntityType }>
  | { type: 'task'; entity: Task };

/**
 * A code step's knob. An `entity` knob holds one of the user's items, such
 * as the channel the step posts in, as a reference to the handle the SDK
 * returned: `{ type: 'channel', entity: channel }`, never an id. The step's
 * code reads it as that handle (`knobs.bugs.send(...)`), and the user can
 * pick another item without new code. A knob with nothing picked yet holds
 * `null`. A stored routine passed back gives each picked item again as a
 * handle (`{ type: 'channel', entity: macro.channels.byId(value.id) }`), as
 * its Ask AI step gives its agent.
 */
export type RoutineKnobOptions =
  | Exclude<RoutineKnob, { type: 'entity' }>
  | (Omit<Extract<RoutineKnob, { type: 'entity' }>, 'value'> & {
      value?: RoutineKnobItem | null;
    });

/** A code step, its entity knobs holding handles. */
export type CodeStepOptions = Omit<CodeStep, 'knobs'> & {
  knobs?: readonly RoutineKnobOptions[];
};

/**
 * A routine step. A `code` step runs TypeScript against this SDK, as the
 * routine's owner; an `agent` ("Ask AI") step hands the run to a model or
 * agent with instructions. A routine has at most one agent step.
 */
export type RoutineStepOptions =
  | ({ type: 'code' } & CodeStepOptions)
  | {
      type: 'agent';
      /** What the model or agent should do; it also sees earlier steps' output. */
      instructions: string;
      /** Model to run the step, or the model override for `agent`. Set `model`, `agent`, or both. */
      model?: RoutineModelId;
      /** Agent to run the step. Set `model`, `agent`, or both. */
      agent?: Agent;
    };

/** An app outside Macro that a routine's Ask AI step uses. */
export interface RoutineApp {
  /**
   * The app's slug, e.g. `linear`: a connected app's `key`, or a connector's
   * `slug`.
   */
  slug: string;
  /** Its display name, e.g. `Linear`. */
  name: string;
}

/** What every routine has, whatever it runs. */
interface RoutineCommonOptions {
  /** Display name. */
  name: string;
  /**
   * Schedules or Macro events that start the routine. A cron `schedule` has 6
   * or 7 fields: `sec min hour day-of-month month day-of-week [year]`.
   */
  trigger: RoutineTriggerOptions;
  /** Whether triggers can start executions. Defaults to true on creation. */
  enabled?: boolean;
  /**
   * Whether runs appear in Home and the Agents list. Defaults to `unlisted` on
   * creation; an update that omits it keeps the stored value.
   */
  runVisibility?: RunVisibility;
  /**
   * An icon and color for what the routine does, picked by the agent writing
   * it: `{ icon: { kind: 'macro', name }, color }`, with `name` from Macro's
   * icon catalog (a check or save naming another lists the catalog). Saved
   * on create, and on an update made for the routine's owner, unless the
   * owner chose the routine's look with {@link Routine.setAppearance}, which
   * it never replaces; omit it to keep the stored look.
   */
  appearance?: EntityAppearance;
  /**
   * Apps outside Macro (Linear, GitHub, Notion…) the routine's Ask AI step
   * uses. The owner must have each connected: saving and every run check.
   * Only an Ask AI step reaches them, so a routine without one requires
   * none. An update that omits `apps` is refused while the routine requires
   * some; pass `[]` to remove them.
   */
  apps?: readonly RoutineApp[];
}

/**
 * A routine that hands each run to one model or agent: the older form, which
 * runs as one Ask AI step. Write new routines as {@link StepsRoutineOptions}.
 */
export interface AgentRoutineOptions extends RoutineCommonOptions {
  /** Instructions delivered to the agent. */
  prompt: string;
  /** Original user instructions. */
  userPrompt: string;
  /**
   * Model to run the task, e.g. `anthropic/claude-sonnet-5-5`, or the model
   * override for `agent`. Set `model`, `agent`, or both.
   */
  model?: RoutineModelId;
  /**
   * Agent to run the task: a built-in agent, or one the caller owns or can
   * use, including one on a self-hosted runtime. Access is checked on save and
   * again on every run. Set `model`, `agent`, or both.
   */
  agent?: Agent;
  steps?: never;
  dangerouslyOperateAsUser?: never;
}

/** A routine that runs code and Ask AI steps in order. */
export interface StepsRoutineOptions extends RoutineCommonOptions {
  /** Run in order; a failed step stops the run. Saving type-checks the code. */
  steps: readonly RoutineStepOptions[];
  /**
   * Make code steps' messages, comments and emails appear written by the
   * owner, with no agent badge. Set it only when the user explicitly asked
   * for the routine to act, send or post as them; never infer it from what
   * the routine does. Omitted, writes are attributed to Macro's agent acting
   * for the owner, and an update that omits it turns it off.
   */
  dangerouslyOperateAsUser?: boolean;
  prompt?: never;
  userPrompt?: never;
  model?: never;
  agent?: never;
}

/** Configuration of a routine: code and Ask AI steps, or the older single agent task. */
export type RoutineOptions = AgentRoutineOptions | StepsRoutineOptions;

/** A scheduled or event-triggered agent task. */
export class Routine extends MacroEntity<ScheduledActionResponse> {
  /**
   * The routine's URL in the Macro web app; hand it to users as the link.
   *
   * @readonly
   */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/routines/${this.id}`;
  }

  /** Identity, loaded detail and {@link webUrl}, so serialized handles carry their link. */
  override toJSON() {
    return { ...super.toJSON(), url: this.webUrl() };
  }

  /** Construct a lazy routine handle. */
  static byId(client: MacroClient, id: string): Routine {
    return new Routine(client, id);
  }

  /** Seed a handle from a server record. */
  static from(client: MacroClient, record: ScheduledActionResponse): Routine {
    if (!record.id) throw new Error('Routine response has no id');
    return new Routine(client, record.id, record);
  }

  protected async fetch(): Promise<ScheduledActionResponse> {
    return unwrap(
      await this.client.scheduledAction.getScheduledAction({
        path: { id: this.id },
      }),
    );
  }

  /** Routine name. */
  readonly name = this.field('name');

  /** Shared icon and color overrides. */
  readonly appearance = this.field('appearance');

  /**
   * Replace shared appearance without rescheduling. Pass {} to reset both overrides.
   *
   * @write
   * @idempotent
   */
  setAppearance(appearance: EntityAppearance): Promise<EntityAppearance> {
    return this.mutate((client) =>
      client.scheduledAction.setScheduledActionAppearance({
        path: { id: this.id },
        body: appearance,
      }),
    );
  }

  /** Configured triggers; picked inboxes come back as `Link` handles. */
  readonly trigger = this.mappedField('trigger', (trigger) =>
    triggerDetail(this.client, trigger),
  );

  /** Whether the routine is enabled. */
  readonly enabled = this.field('enabled');

  /** Whether the routine's runs appear in Home and the Agents list. */
  readonly runVisibility = this.field('run_visibility');

  /** Next scheduled execution. */
  readonly nextRunAt = this.field('next_run_at');

  /** Configuration revision. */
  readonly revision = this.field('configuration_revision');

  /** Routine owner. */
  readonly owner = this.mappedField('owner', (id) =>
    User.byId(this.client, id),
  );

  /** The shared routine whose template this routine was activated from. */
  readonly sourceTemplate: () => Promise<Routine | undefined> =
    this.mappedField('template_id', (id): Routine | undefined =>
      id ? Routine.byId(this.client, id) : undefined,
    );

  /**
   * The routine this one follows, when one of that routine's runs created
   * it: pausing the parent pauses it and deleting the parent deletes it.
   * `undefined` for a top-level routine.
   */
  readonly parent: () => Promise<Routine | undefined> = this.mappedField(
    'sub_routine',
    (link): Routine | undefined =>
      link ? Routine.byId(this.client, link.parent_id) : undefined,
  );

  /**
   * The run that created this sub-routine, by the id its history record
   * has once that run ends. `undefined` for a top-level routine.
   */
  readonly createdByRun: () => Promise<RoutineRun | undefined> =
    this.mappedField('sub_routine', (link): RoutineRun | undefined =>
      link ? new RoutineRun(link.created_by_run_id) : undefined,
    );

  /** The key this sub-routine was created under, if its creator gave one. */
  readonly key: () => Promise<string | undefined> = this.mappedField(
    'sub_routine',
    (link) => link?.key ?? undefined,
  );

  /**
   * This routine's sub-routines: the active ones and its newest finished
   * one-time ones.
   *
   * @readonly
   */
  async children(): Promise<Routine[]> {
    return unwrap(
      await this.client.scheduledAction.listScheduledActions({
        query: { include_events: true, parent: this.id },
      }),
    ).map((record) => Routine.from(this.client, record));
  }

  /**
   * Keep this sub-routine as the user's own routine: it moves to their main
   * list and no longer pauses or is deleted with its parent.
   *
   * @write
   */
  async keepAsOwn(): Promise<void> {
    await this.mutate((c) =>
      c.scheduledAction.detachScheduledAction({ path: { id: this.id } }),
    );
  }

  /**
   * This routine's shared template, or `undefined` when it isn't shared.
   *
   * @readonly
   */
  async template(): Promise<RoutineTemplate | undefined> {
    const result = await this.client.scheduledAction.getScheduledActionTemplate(
      { path: { id: this.id } },
    );
    if (result.response?.status === 404) return undefined;
    return this.toTemplate(unwrap(result));
  }

  /**
   * Share this routine as a template, or update its shared snapshot. People
   * get the template, never the routine, its runs or its results.
   *
   * @write
   * @idempotent
   */
  async shareAsTemplate(options: {
    /** What the routine does for someone. */
    description: string;
    /** How each user-specific reference fills in when someone activates it. */
    variables: TemplateVariable[];
  }): Promise<RoutineTemplate> {
    return this.toTemplate(
      unwrap(
        await this.client.scheduledAction.shareScheduledActionTemplate({
          path: { id: this.id },
          body: options,
        }),
      ),
    );
  }

  /**
   * Create the caller's own routine from this routine's shared template, with
   * its references already filled in for them.
   *
   * @write
   */
  async activateTemplate(options: RoutineOptions): Promise<Routine> {
    return Routine.from(
      this.client,
      unwrap(
        await this.client.scheduledAction.activateScheduledActionTemplate({
          path: { id: this.id },
          body: { ...routineBody(options), enabled: options.enabled ?? true },
        }),
      ),
    );
  }

  private toTemplate(record: RoutineTemplateRecord): RoutineTemplate {
    return new RoutineTemplate(
      this,
      User.byId(this.client, record.author),
      record,
    );
  }

  /**
   * Stop sharing this routine. Routines already activated keep running.
   *
   * @destructive
   * @idempotent
   */
  async stopSharingTemplate(): Promise<void> {
    unwrap(
      await this.client.scheduledAction.unshareScheduledActionTemplate({
        path: { id: this.id },
      }),
    );
  }

  /**
   * Replace the routine's task and trigger configuration.
   *
   * @write
   * @idempotent
   */
  async update(options: RoutineOptions): Promise<void> {
    await this.mutate((c) =>
      c.scheduledAction.updateScheduledAction({
        path: { id: this.id },
        body: routineBody(options),
      }),
    );
  }

  /**
   * Enable or disable triggering.
   *
   * @write
   * @idempotent
   */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.mutate((c) =>
      c.scheduledAction.setScheduledActionEnabled({
        path: { id: this.id },
        body: { enabled },
      }),
    );
  }

  /**
   * Start an execution immediately and return its transcript handle if available.
   *
   * @write
   */
  async execute(): Promise<Chat | AgentSession | undefined> {
    const result = unwrap(
      await this.client.scheduledAction.executeScheduledActionNow({
        path: { id: this.id },
      }),
    );
    if (result.resource)
      return match(result.resource)
        .with({ type: 'agent' }, (resource) =>
          AgentSession.byId(this.client, resource.id),
        )
        .with({ type: 'chat' }, (resource) =>
          Chat.byId(this.client, resource.id),
        )
        .exhaustive();
    return result.chat_id ? Chat.byId(this.client, result.chat_id) : undefined;
  }

  /**
   * Stop the run in progress. It ends as stopped shortly after; with none
   * running, nothing changes.
   *
   * @write
   * @idempotent
   */
  async stop(): Promise<void> {
    unwrap(
      await this.client.scheduledAction.stopScheduledActionRun({
        path: { id: this.id },
      }),
    );
  }

  /**
   * Completed executions, with their routine scoped identity.
   *
   * @readonly
   */
  async history(): Promise<RoutineExecution[]> {
    return unwrap(
      await this.client.scheduledAction.listScheduledActionHistory({
        path: { id: this.id },
      }),
    ).map(
      (record) =>
        new RoutineExecution(
          this,
          record,
          (record.created ?? []).map((routine) =>
            Routine.byId(this.client, routine.id),
          ),
        ),
    );
  }

  /**
   * Delete the routine.
   *
   * @destructive
   * @idempotent
   */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.scheduledAction.deleteScheduledAction({ path: { id: this.id } }),
    );
  }
}

/**
 * One run of a routine, by the id of its history record.
 *
 * @mcp-exclude Read from a sub-routine's record; no call takes one.
 */
export class RoutineRun {
  constructor(
    /** The run's id, which its {@link RoutineExecution} has once it ends. */
    readonly id: string,
  ) {}

  /** Serialize the run's identity. */
  toJSON() {
    return { id: this.id };
  }
}

/**
 * A routine shared as a template, which people activate as their own routine.
 *
 * @mcp-exclude Built from a listing record; no id-only reference an MCP call can pass.
 */
export class RoutineTemplate {
  constructor(
    /** The shared routine. */
    readonly routine: Routine,
    /** Who shared it. */
    readonly author: User,
    /** Template snapshot. */
    readonly record: RoutineTemplateRecord,
  ) {}

  /**
   * Create the caller's own routine from this template, with its references
   * already filled in for them.
   *
   * @write
   */
  activate(options: RoutineOptions): Promise<Routine> {
    return this.routine.activateTemplate(options);
  }

  /** Serialize without the authenticated client. */
  toJSON() {
    return this.record;
  }
}

/** A completed routine execution, as recorded by the service. */
export class RoutineExecution {
  constructor(
    /** Parent routine. */
    readonly routine: Routine,
    /** Execution snapshot. */
    readonly record: import('../../../generated/scheduled-action/types.gen').ExecutionRecordResponse,
    /** The sub-routines this run created that still follow the routine. */
    readonly created: Routine[] = [],
  ) {}

  /** Execution identity, when assigned. */
  get id(): string | undefined {
    return this.record.id ?? undefined;
  }

  /** Serialize without the authenticated client. */
  toJSON() {
    return { routine: this.routine.id, ...this.record };
  }
}

function knobBody(knob: RoutineKnobOptions): RoutineKnob {
  if (knob.type !== 'entity') return knob;
  const { value, ...rest } = knob;
  return {
    ...rest,
    value: value ? { type: value.type, id: value.entity.id } : null,
  };
}

function stepBody(step: RoutineStepOptions): RoutineStep {
  return match(step)
    .returnType<RoutineStep>()
    .with({ type: 'code' }, ({ knobs, ...code }) => ({
      ...code,
      ...(knobs ? { knobs: knobs.map(knobBody) } : {}),
    }))
    .with({ type: 'agent' }, ({ agent, ...rest }) => ({
      ...rest,
      agent: agent ? { bot_id: agent.id } : undefined,
    }))
    .exhaustive();
}

/** The apps a routine requires, as its task stores them; absent when not given. */
export function appsBody(
  apps: readonly RoutineApp[] | undefined,
): AgentMcpServer[] | undefined {
  return apps?.map((app) => ({ app_slug: app.slug, server_name: app.name }));
}

function taskBody(options: RoutineOptions): RoutineTask {
  const mcpServers = appsBody(options.apps);
  return match(options)
    .returnType<RoutineTask>()
    .with({ steps: P.array() }, (program) => ({
      steps: program.steps.map(stepBody),
      dangerously_operate_as_user: program.dangerouslyOperateAsUser,
      mcp_servers: mcpServers,
    }))
    .with(
      { prompt: P.string },
      (agentTask): AgentTask => ({
        prompt: agentTask.prompt,
        user_prompt: agentTask.userPrompt,
        model: agentTask.model,
        agent: agentTask.agent ? { bot_id: agentTask.agent.id } : undefined,
        mcp_servers: mcpServers,
      }),
    )
    .exhaustive();
}

/** Translate typed routine options into the generated wire contract. */
export function routineBody(options: RoutineOptions) {
  return {
    kind: 'Agent' as const,
    name: options.name,
    enabled: options.enabled,
    run_visibility: options.runVisibility,
    appearance: options.appearance,
    trigger: triggerBody(options.trigger),
    task: taskBody(options),
  };
}
