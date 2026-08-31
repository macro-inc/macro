import type { SandboxSize } from '../../../generated/agent-harness/types.gen';
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
  createManaged(opts?: {
    prompt?: string;
    instructions?: string;
  }): Promise<AgentSession> {
    return AgentSession.createManaged(this.client, opts);
  }

  /** The caller's default sandbox size for new `@coder` sessions. */
  defaultSandboxSize(): Promise<SandboxSize> {
    return AgentSession.defaultSandboxSize(this.client);
  }

  /** Set the caller's default sandbox size for the next `@coder` mention. */
  setDefaultSandboxSize(size: SandboxSize): Promise<SandboxSize> {
    return AgentSession.setDefaultSandboxSize(this.client, size);
  }
}
