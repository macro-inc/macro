import { match, P } from 'ts-pattern';
import type {
  ActionTrigger,
  AgentTask,
  CodeStep,
  EventFilter,
  RoutineModelId,
  RoutineStep,
  RoutineTask,
  RoutineTemplate as RoutineTemplateRecord,
  RoutineTrigger,
  RunVisibility,
  ScheduledActionResponse,
  TemplateVariable,
} from '../../../generated/scheduled-action/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { AgentSession } from '../agent-sessions/agent-session';
import type { Agent } from '../agents/agent';
import { Chat } from '../chats/chat';
import { MacroEntity } from '../entity';
import type { EntityReference } from '../reference';
import { User } from '../users/user';

/** An event selector references resources by typed handles. */
export type RoutineEventFilter = Omit<EventFilter, 'ids' | 'condition'> & {
  /**
   * The items these events are watched on, as references to handles the SDK
   * returned, such as `{ type: 'channel', entity: channel }`; never ids.
   * Omit to match all items.
   */
  entities?: EntityReference[];
  /** Optional yes/no condition on the triggering content. */
  condition?: string;
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
      filters: value.filters.map(({ entities, ...filter }) => ({
        ...filter,
        ids: entities?.map((entity) => entity.entity.id),
      })),
    }))
    .exhaustive();
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
 * A routine step. A `code` step runs TypeScript against this SDK, as the
 * routine's owner; an `agent` ("Ask AI") step hands the run to a model or
 * agent with instructions. A routine has at most one agent step.
 */
export type RoutineStepOptions =
  | ({ type: 'code' } & CodeStep)
  | {
      type: 'agent';
      /** What the model or agent should do; it also sees earlier steps' output. */
      instructions: string;
      /** Model to run the step, or the model override for `agent`. Set `model`, `agent`, or both. */
      model?: RoutineModelId;
      /** Agent to run the step. Set `model`, `agent`, or both. */
      agent?: Agent;
    };

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
}

/** A routine that hands each run to one model or agent. */
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

/** Configuration of a routine: one agent task, or code and Ask AI steps. */
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

  /** Configured triggers. */
  readonly trigger = this.field('trigger');

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
   * Completed executions, with their routine scoped identity.
   *
   * @readonly
   */
  async history(): Promise<RoutineExecution[]> {
    return unwrap(
      await this.client.scheduledAction.listScheduledActionHistory({
        path: { id: this.id },
      }),
    ).map((record) => new RoutineExecution(this, record));
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
    readonly record: import('../../../generated/scheduled-action/types.gen').ActionExecutionRecord,
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

function stepBody(step: RoutineStepOptions): RoutineStep {
  return match(step)
    .returnType<RoutineStep>()
    .with({ type: 'code' }, (code) => code)
    .with({ type: 'agent' }, ({ agent, ...rest }) => ({
      ...rest,
      agent: agent ? { bot_id: agent.id } : undefined,
    }))
    .exhaustive();
}

function taskBody(options: RoutineOptions): RoutineTask {
  return match(options)
    .returnType<RoutineTask>()
    .with({ steps: P.array() }, (program) => ({
      steps: program.steps.map(stepBody),
      dangerously_operate_as_user: program.dangerouslyOperateAsUser,
    }))
    .with(
      { prompt: P.string },
      (agentTask): AgentTask => ({
        prompt: agentTask.prompt,
        user_prompt: agentTask.userPrompt,
        model: agentTask.model,
        agent: agentTask.agent ? { bot_id: agentTask.agent.id } : undefined,
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
    trigger: triggerBody(options.trigger),
    task: taskBody(options),
  };
}
