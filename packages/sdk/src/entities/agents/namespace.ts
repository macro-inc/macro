import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Agent, type AgentOptions, agentBody } from './agent';

/** Configurable agents. */
export class AgentNamespace {
  constructor(private readonly client: MacroClient) {}

  /** Construct a lazy agent handle. */
  byId(id: string): Agent {
    return Agent.byId(this.client, id);
  }

  /** All accessible agents. */
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
