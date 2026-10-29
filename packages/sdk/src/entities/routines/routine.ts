import { match } from 'ts-pattern';
import type {
  ActionTrigger,
  AgentTask,
  EventFilter,
  RoutineModelId,
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
  /** Resource selectors for these events. Omit to match all resources. */
  entities?: EntityReference[];
  /** Optional yes/no condition on the triggering content. */
  condition?: string;
};

/** One schedule or set of event selectors. */
export type SingleRoutineTrigger =
  | Extract<RoutineTrigger, { type: 'cron' }>
  | { type: 'events'; filters: RoutineEventFilter[] };

/** One or multiple routine triggers. */
export type RoutineTriggerOptions =
  | SingleRoutineTrigger
  | { type: 'multiple'; triggers: SingleRoutineTrigger[] };

function singleTriggerBody(trigger: SingleRoutineTrigger): RoutineTrigger {
  return match(trigger)
    .with({ type: 'cron' }, (value) => value)
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
    .with({ type: 'events' }, singleTriggerBody)
    .exhaustive();
}

/** Configuration of an agent routine. */
export interface RoutineOptions {
  /** Display name. */
  name: string;
  /** Schedules or Macro events that start the routine. */
  trigger: RoutineTriggerOptions;
  /** Instructions delivered to the agent. */
  prompt: string;
  /** Original user instructions. */
  userPrompt: string;
  /** Model override. */
  model?: RoutineModelId;
  /** Agent to run the task. */
  agent?: Agent;
  /** Whether triggers can start executions. Defaults to true on creation. */
  enabled?: boolean;
  /**
   * Whether runs appear in Home and the Agents list. Defaults to `unlisted` on
   * creation; an update that omits it keeps the stored value.
   */
  runVisibility?: RunVisibility;
}

/** A scheduled or event-triggered agent task. */
export class Routine extends MacroEntity<ScheduledActionResponse> {
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

  /** This routine's shared template, or `undefined` when it isn't shared. */
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

  /** Stop sharing this routine. Routines already activated keep running. */
  async stopSharingTemplate(): Promise<void> {
    unwrap(
      await this.client.scheduledAction.unshareScheduledActionTemplate({
        path: { id: this.id },
      }),
    );
  }

  /** Replace the routine's task and trigger configuration. */
  async update(options: RoutineOptions): Promise<void> {
    await this.mutate((c) =>
      c.scheduledAction.updateScheduledAction({
        path: { id: this.id },
        body: routineBody(options),
      }),
    );
  }

  /** Enable or disable triggering. */
  async setEnabled(enabled: boolean): Promise<void> {
    await this.mutate((c) =>
      c.scheduledAction.setScheduledActionEnabled({
        path: { id: this.id },
        body: { enabled },
      }),
    );
  }

  /** Start an execution immediately and return its transcript handle if available. */
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

  /** Completed executions, with their routine scoped identity. */
  async history(): Promise<RoutineExecution[]> {
    return unwrap(
      await this.client.scheduledAction.listScheduledActionHistory({
        path: { id: this.id },
      }),
    ).map((record) => new RoutineExecution(this, record));
  }

  /** Delete the routine. */
  async delete(): Promise<void> {
    await this.mutate((c) =>
      c.scheduledAction.deleteScheduledAction({ path: { id: this.id } }),
    );
  }
}

/** A routine shared as a template, which people activate as their own routine. */
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

/** Translate typed routine options into the generated wire contract. */
export function routineBody(options: RoutineOptions) {
  const task: AgentTask = {
    prompt: options.prompt,
    user_prompt: options.userPrompt,
    model: options.model,
    agent: options.agent ? { bot_id: options.agent.id } : undefined,
  };
  return {
    kind: 'Agent' as const,
    name: options.name,
    enabled: options.enabled,
    run_visibility: options.runVisibility,
    trigger: triggerBody(options.trigger),
    task: { ...task },
  };
}
