import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Agent, type AgentOptions, agentBody } from './agent';

/**
 * Configurable agents.
 *
 * @routing Use when the user wants to change how one of their Macro agent personas is set up: its instructions, model, runtime, channels or hosts; not any request the user asks you, the agent, to carry out.
 */
export class AgentNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy agent handle. */
  byId(id: string): Agent {
    return Agent.byId(this.client, id);
  }

  /**
   * Accessible custom agents. Pass one to
   * {@link AgentSessionNamespace.createManaged} to start a session as that
   * persona. System personas such as Cursor are constructed with
   * {@link Agent.byId}.
   */
  async list(): Promise<Agent[]> {
    return unwrap(await this.client.storage.listAgents()).map((a) =>
      Agent.from(this.client, a),
    );
  }

  /** Create an agent. */
  async create(options: AgentOptions): Promise<Agent> {
    return Agent.from(
      this.client,
      unwrap(
        await this.client.storage.createAgent({ body: agentBody(options) }),
      ),
    );
  }
}
