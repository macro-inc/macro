import type {
  ActivityWireRow,
  AgentActivityCursor,
} from '../../../generated/agent-harness/types.gen';
import { paginate, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { AgentSession } from './agent-session';

/** Page options for recorded session activity, newest first. */
export type AgentActivityOptions = {
  /** Page size, from 1 to 100; defaults to 50. */
  limit?: number;
  /** Restrict to one code-mode invocation belonging to this session. */
  invocation?: AgentInvocation;
};

/** A code-mode invocation, identified independently of its runtime or retries. */
export class AgentInvocation {
  private constructor(
    private readonly client: MacroClient,
    private readonly parent: AgentSession,
    readonly id: string,
  ) {}

  /** Construct a handle without making a request. */
  static byId(client: MacroClient, session: AgentSession, id: string) {
    return new AgentInvocation(client, session, id);
  }

  /**
   * The session that owns this invocation.
   *
   * @readonly
   */
  session(): AgentSession {
    return this.parent;
  }

  /**
   * Recorded activity caused by this invocation, lazily paginated.
   *
   * @readonly
   */
  activity(options: Omit<AgentActivityOptions, 'invocation'> = {}) {
    return sessionActivity(this.client, this.parent, {
      ...options,
      invocation: this,
    });
  }

  /** Safe identity without an authenticated client. */
  toJSON() {
    return { id: this.id, session: { id: this.parent.id } };
  }
}

/** An original activity-history row attributed to a session. */
export type AgentActivity = {
  /** The originating invocation; absent on legacy rows. */
  invocation?: AgentInvocation;
  /** Original recorded metadata. Action tags and payloads are forward-compatible. */
  snapshot: ActivityWireRow;
};

/** Iterate recorded mutations; reads and failed requests do not create history. */
export function sessionActivity(
  client: MacroClient,
  session: AgentSession,
  options: AgentActivityOptions = {},
): AsyncGenerator<AgentActivity> {
  if (options.invocation && options.invocation.session().id !== session.id) {
    throw new Error('Activity invocation must belong to this session');
  }
  return paginate<AgentActivity, AgentActivityCursor>(async (cursor) => {
    const page = unwrap(
      await client.agentHarness.getAgentSessionActivity({
        path: { session_id: session.id },
        query: {
          limit: options.limit,
          agentCorrelationId: options.invocation?.id,
          beforeAt: cursor?.occurredAt,
          beforeId: cursor?.id,
        },
      }),
    );
    return {
      items: page.activities.map((snapshot) => ({
        snapshot,
        invocation: snapshot.agent_correlation_id
          ? AgentInvocation.byId(client, session, snapshot.agent_correlation_id)
          : undefined,
      })),
      nextCursor: page.nextCursor,
    };
  });
}
