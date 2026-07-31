import type { ChatAgentKind } from '../../../generated/agent-proxy/types.gen';
import type { MacroClient } from '../../utils/client';
import type { Project } from '../projects/project';
import { Agent } from './agent';

export class AgentNamespace {
  constructor(private readonly client: MacroClient) {}

  byId(id: string): Agent {
    return Agent.byId(this.client, id);
  }

  create(opts?: {
    name?: string;
    kind?: ChatAgentKind;
    project?: Project;
  }): Promise<Agent> {
    return Agent.create(this.client, opts);
  }
}
