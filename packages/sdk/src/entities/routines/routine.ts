import { match } from 'ts-pattern';
import type {
  ActionTrigger,
  AgentTask,
  EventFilter,
  RoutineModelId,
  RoutineTrigger,
  RunVisibility,
  ScheduledActionResponse,
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
