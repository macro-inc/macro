import type {
  AgentMode,
  AutoArchivePreferencesBody,
  CodingPreferencesBody,
  SandboxSize,
} from '../../../generated/agent-harness/types.gen';
import type { MacroClient } from '../../utils/client';
import {
  AgentSession,
  type AgentSessionUpdates,
  type CreateManagedSessionOptions,
  type RegisteredWork,
  type SelectableRepository,
} from './agent-session';

/**
 * Entry point for coding-agent sessions.
 *
 * @routing Use when work happens in a code repository or with a coding agent: writing code, fixing a bug, opening or changing a pull request, or reading an agent session's history; not changes to Macro databases or documents.
 *
 * @agent
 * ## Starting agent sessions
 *
 * Do repository and coding work yourself when you can. Start another agent session only when the user asks for one, or the work needs a repository runtime you do not have.
 *
 * Start sessions from ExecuteCode. For coding work, macro.agents.coding() lists the coding personas the user can start right now, built-in ones such as Cursor included; for a chat agent, macro.agents.list() lists the user's configurable agents. Choose by name, description and instructions, preferring an agent the user named, and pass its `agent` handle to macro.agentSessions.createManaged. Never invent an agent or construct one by id. To use Macro's default persona instead, omit `agent`. Read AgentSessionNamespace.createManaged with ReadCodeDocs before the first call.
 *
 * ```javascript
 * export async function main({macro}) {
 *   const coding = await macro.agents.coding();
 *   const chosen = coding.find((option) => option.name === 'Cursor');
 *   if (!chosen) return {data: {error: 'Cursor is not connected', available: coding.map((option) => option.name)}};
 *   const session = await macro.agentSessions.createManaged({
 *     agent: chosen.agent,
 *     repoUrl: 'https://github.com/acme/web',
 *     prompt: 'Fix the login redirect loop in acme/web. ...',
 *   });
 *   return {data: {sessionId: session.id}};
 * }
 * ```
 *
 * The prompt must be self-contained: the task, repository, relevant findings and links, constraints, and expected outcome. The new session does not receive this conversation. When the outcome is a pull request, require it to be ready for review, not a draft, with CI passing before the agent finishes. Create once per task and do not retry automatically after an uncertain failure. Link the session in your reply with its id. To check on it later, create a routine; never wait or poll inside an execution.
 *
 * ## Sessions waiting for the user
 *
 * macro.agentSessions.updates() lists the user's sessions waiting on them (permission requests, questions, held tool approvals) or stalled. A session's held tool calls come from session.pendingApprovals(); approve or deny one only when the user said so for that call. session.linkTask(task) links a session the user owns to its Macro task, and the session's pull request with it.
 */
export class AgentSessionNamespace {
  constructor(private readonly client: MacroClient) {}

  /** A handle to an agent session by id. Details load on first access. */
  byId(id: string): AgentSession {
    return AgentSession.byId(this.client, id);
  }

  /**
   * Create a managed session as `agent` when one is named, otherwise the
   * deployment's default persona. Take `agent` from
   * {@link AgentNamespace.coding} (coding personas, Cursor included) or
   * {@link AgentNamespace.list} (configurable agents); never construct one
   * from an id. Unknown or inaccessible personas fail. `model` and `instructions`
   * outrank the persona's. `repoUrl` is honored for Cursor; omit `agent`
   * and it starts as Cursor.
   *
   * @write
   * @openworld
   */
  createManaged(opts?: CreateManagedSessionOptions): Promise<AgentSession> {
    return AgentSession.createManaged(this.client, opts);
  }

  /**
   * The sessions the caller registered as its work with
   * {@link AgentSession.registerAsWork} and can still view, newest first.
   * Ended registrations and archived sessions are left out.
   *
   * @readonly
   */
  registeredWork(): Promise<RegisteredWork[]> {
    return AgentSession.listRegisteredWork(this.client);
  }

  /**
   * Whether `prompt` needs a chat agent (`'chat'`) or a coding agent
   * (`'code'`), as the app's Auto mode decides before starting a session.
   *
   * @write
   */
  chooseMode(prompt: string): Promise<AgentMode> {
    return AgentSession.chooseMode(this.client, prompt);
  }

  /**
   * The GitHub repositories the caller can hand a managed session, with the
   * branch each one's sessions start on by default.
   *
   * @readonly
   * @openworld
   */
  repositories(): Promise<SelectableRepository[]> {
    return AgentSession.repositories(this.client);
  }

  /**
   * Branch names on one repository the caller can start a managed session
   * from. `repoUrl` is one of the URLs {@link AgentSessionNamespace.repositories}
   * lists.
   *
   * @readonly
   * @openworld
   */
  repositoryBranches(repoUrl: string): Promise<string[]> {
    return AgentSession.repositoryBranches(this.client, repoUrl);
  }

  /**
   * The caller's coding sessions waiting for them: permission requests,
   * questions and held tool approvals to answer, and sessions stalled for
   * over 20 minutes, newest activity first. Read a session's held approvals
   * with {@link AgentSession.pendingApprovals}.
   *
   * @readonly
   */
  updates(): Promise<AgentSessionUpdates> {
    return AgentSession.updates(this.client);
  }

  /**
   * The sessions linked to the GitHub pull request at `url` that the caller
   * can view.
   *
   * @readonly
   */
  forPullRequest(url: string): Promise<AgentSession[]> {
    return AgentSession.forPullRequest(this.client, url);
  }

  /**
   * The caller's default sandbox size for new `@coder` sessions.
   *
   * @readonly
   */
  defaultSandboxSize(): Promise<SandboxSize> {
    return AgentSession.defaultSandboxSize(this.client);
  }

  /**
   * Set the caller's default sandbox size for the next `@coder` mention.
   *
   * @write
   * @idempotent
   */
  setDefaultSandboxSize(size: SandboxSize): Promise<SandboxSize> {
    return AgentSession.setDefaultSandboxSize(this.client, size);
  }

  /**
   * What the caller's new coding sessions are told to do beyond their assignment.
   *
   * @readonly
   */
  codingPreferences(): Promise<CodingPreferencesBody> {
    return AgentSession.codingPreferences(this.client);
  }

  /**
   * Which triggers archive the caller's sessions by default; each is off unless chosen.
   *
   * @readonly
   */
  autoArchivePreferences(): Promise<AutoArchivePreferencesBody> {
    return AgentSession.autoArchivePreferences(this.client);
  }

  /**
   * Replace which triggers archive the caller's sessions by default.
   *
   * @write
   * @idempotent
   */
  setAutoArchivePreferences(
    preferences: AutoArchivePreferencesBody,
  ): Promise<AutoArchivePreferencesBody> {
    return AgentSession.setAutoArchivePreferences(this.client, preferences);
  }

  /**
   * Replace the caller's coding preferences.
   *
   * @write
   * @idempotent
   */
  setCodingPreferences(
    preferences: CodingPreferencesBody,
  ): Promise<CodingPreferencesBody> {
    return AgentSession.setCodingPreferences(this.client, preferences);
  }
}
