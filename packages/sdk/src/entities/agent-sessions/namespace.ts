import type {
  AgentMode,
  AutoArchivePreferencesBody,
  CodingPreferencesBody,
  SandboxSize,
} from '../../../generated/agent-harness/types.gen';
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
   * Whether `prompt` needs a chat agent (`'chat'`) or a coding agent
   * (`'code'`), as the app's Auto mode decides before starting a session.
   */
  chooseMode(prompt: string): Promise<AgentMode> {
    return AgentSession.chooseMode(this.client, prompt);
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

  /**
   * The sessions linked to the GitHub pull request at `url` that the caller
   * can view.
   */
  forPullRequest(url: string): Promise<AgentSession[]> {
    return AgentSession.forPullRequest(this.client, url);
  }

  /** The caller's default sandbox size for new `@coder` sessions. */
  defaultSandboxSize(): Promise<SandboxSize> {
    return AgentSession.defaultSandboxSize(this.client);
  }

  /** Set the caller's default sandbox size for the next `@coder` mention. */
  setDefaultSandboxSize(size: SandboxSize): Promise<SandboxSize> {
    return AgentSession.setDefaultSandboxSize(this.client, size);
  }

  /** What the caller's new coding sessions are told to do beyond their assignment. */
  codingPreferences(): Promise<CodingPreferencesBody> {
    return AgentSession.codingPreferences(this.client);
  }

  /** Which triggers archive the caller's sessions by default; each is off unless chosen. */
  autoArchivePreferences(): Promise<AutoArchivePreferencesBody> {
    return AgentSession.autoArchivePreferences(this.client);
  }

  /** Replace which triggers archive the caller's sessions by default. */
  setAutoArchivePreferences(
    preferences: AutoArchivePreferencesBody,
  ): Promise<AutoArchivePreferencesBody> {
    return AgentSession.setAutoArchivePreferences(this.client, preferences);
  }

  /** Replace the caller's coding preferences. */
  setCodingPreferences(
    preferences: CodingPreferencesBody,
  ): Promise<CodingPreferencesBody> {
    return AgentSession.setCodingPreferences(this.client, preferences);
  }
}
