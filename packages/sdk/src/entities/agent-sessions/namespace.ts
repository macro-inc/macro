import type { SandboxSize } from '../../../generated/agent-harness/types.gen';
import type { MacroClient } from '../../utils/client';
import {
  AgentSession,
  type CreateManagedSessionOptions,
  type SelectableRepository,
} from './agent-session';

/** Entry point for coding-agent sessions. */
export class AgentSessionNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to an agent session by id. Details load on first access. */
  byId(id: string): AgentSession {
    return AgentSession.byId(this.client, id);
  }

  /** Create a managed agent session. */
  createManaged(opts?: CreateManagedSessionOptions): Promise<AgentSession> {
    return AgentSession.createManaged(this.client, opts);
  }

  /**
   * The GitHub repositories the caller can hand a managed session, with the
   * branch each one's sessions start on by default.
   */
  repositories(): Promise<SelectableRepository[]> {
    return AgentSession.repositories(this.client);
  }

  /**
   * Branch names on one repository the caller can start a managed session
   * from. `repoUrl` is one of the URLs {@link AgentSessionNamespace.repositories}
   * lists.
   */
  repositoryBranches(repoUrl: string): Promise<string[]> {
    return AgentSession.repositoryBranches(this.client, repoUrl);
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
