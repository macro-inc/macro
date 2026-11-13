import type {
  AgentWake as AgentWakeRecord,
  AgentWakeStatusFilter,
  WakeRecord,
  WakeTrace,
} from '../../../generated/agent-harness/types.gen';
import { MacroApiError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import type { User } from './user';

export type { AgentWakeStatusFilter, WakeRecord, WakeTrace };

/** Which of an agent account's wakes {@link User.wakes} lists. */
export type AgentWakeFilter = {
  /** Only wakes in this status; `running` is every wake with no `end` record yet. */
  status?: AgentWakeStatusFilter;
};

/**
 * One wake of an agent account: one time a muppet system woke its agent,
 * recorded by the agent as `WakeRecord`s (`start`, `session`, `end`). Macro
 * keeps the latest record per wake, and one trace of its model session.
 * Readable by the agent and the owners and admins of its teams.
 */
export class AgentWake extends MacroEntity<AgentWakeRecord> {
  private constructor(
    client: MacroClient,
    /** The agent account the wake belongs to. */
    readonly agent: User,
    id: string,
    seed?: AgentWakeRecord,
  ) {
    super(client, id, seed);
  }

  /** A handle to one of an agent account's wakes, by the id its records carry. */
  static byId(client: MacroClient, agent: User, id: string): AgentWake {
    return new AgentWake(client, agent, id);
  }

  /** Seed a handle from a listed wake. */
  static from(
    client: MacroClient,
    agent: User,
    record: AgentWakeRecord,
  ): AgentWake {
    return new AgentWake(client, agent, record.record.wake, record);
  }

  protected async fetch(): Promise<AgentWakeRecord> {
    return unwrap(
      await this.client.agentHarness.getAgentWake({
        path: { agent_user_id: this.agent.id, wake_id: this.id },
      }),
    );
  }

  /** The latest record: the whole wake once its `end` record arrived. */
  readonly record = this.field('record');

  /** When that record arrived. */
  readonly receivedAt = this.field('receivedAt');

  /** When its trace was last uploaded, or `undefined` if none was. */
  readonly traceUpdatedAt = this.field('traceUpdatedAt');

  /**
   * The wake's trace: its model session's prompt, turns and tool calls, as
   * the agent last uploaded it, redacted.
   *
   * @returns The trace, or `undefined` when none was uploaded or it expired
   * (traces are kept 30 days after their last upload).
   *
   * @readonly
   */
  async trace(): Promise<WakeTrace | undefined> {
    try {
      return unwrap(
        await this.client.agentHarness.getAgentWakeTrace({
          path: { agent_user_id: this.agent.id, wake_id: this.id },
        }),
      );
    } catch (error) {
      if (error instanceof MacroApiError && error.status === 404)
        return undefined;
      throw error;
    }
  }

  /**
   * Replace this wake's trace. Only the agent account itself may, for a wake
   * it has recorded; redact credentials before uploading. At most 10 MiB.
   *
   * @write
   * @idempotent
   */
  async uploadTrace(trace: WakeTrace): Promise<void> {
    unwrap(
      await this.client.agentHarness.putAgentWakeTrace({
        path: { agent_user_id: this.agent.id, wake_id: this.id },
        body: trace,
      }),
    );
  }
}
