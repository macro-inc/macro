import type { MacroClient } from '../../utils/client';
import { AgentSession } from './agent-session';

/** Entry point for coding-agent sessions. */
export class AgentSessionNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to an agent session by id. Details load on first access. */
  byId(id: string): AgentSession {
    return AgentSession.byId(this.client, id);
  }

  /** Create a managed agent session. */
  createManaged(opts?: { prompt?: string }): Promise<AgentSession> {
    return AgentSession.createManaged(this.client, opts);
  }
}
