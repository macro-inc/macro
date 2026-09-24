import type {
  AgentAction,
  AgentSessionChangesResponse,
  AgentSessionLogResponse,
  AgentSessionResponse,
  ControlResponse,
  PromptAttachment,
  SandboxSize,
} from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { QueuedAction } from './queued-action';

/** A GitHub repository the caller can point a managed session at. */
export type SelectableRepository = {
  /** The canonical `https://github.com/owner/name` URL, as `createManaged` takes it. */
  url: string;
  /**
   * The branch its clones check out, and where a session starts unless
   * `createManaged` names another. Absent for a repository with no commits.
   */
  defaultBranch?: string;
};

/** What a managed session is created with. */
export type CreateManagedSessionOptions = {
  /** First prompt to deliver once the session is running. */
  prompt?: string;
  /** Instructions the session's runtime works under, fixed for its life. */
  instructions?: string;
  /**
   * The model the session runs on, instead of its persona's. The session's
   * model from creation, read back as {@link AgentSession.model}.
   */
  model?: string;
  /**
   * The repository the session works on, as one of the URLs
   * {@link AgentSession.repositories} lists for the caller. Omitted, the
   * runtime chooses from the prompt. Honored for Cursor sessions.
   */
  repoUrl?: string;
  /**
   * The branch the session starts on; needs `repoUrl`. Omitted, the
   * repository's default branch.
   */
  repoBranch?: string;
};

/** A managed or externally hosted coding-agent session. */
export class AgentSession extends MacroEntity<AgentSessionResponse> {
  /** A handle to an agent session by id. Details load on first access. */
  static byId(client: MacroClient, id: string): AgentSession {
    return new AgentSession(client, id);
  }

  /** Create a managed session, optionally delivering its first prompt. */
  static async createManaged(
    client: MacroClient,
    opts?: CreateManagedSessionOptions
  ): Promise<AgentSession> {
    const { session } = unwrap(
      await client.agentHarness.createAgentSession({
        body: {
          prompt: opts?.prompt,
          instructions: opts?.instructions,
          model: opts?.model,
          repoUrl: opts?.repoUrl,
          repoBranch: opts?.repoBranch,
        },
      })
    );
    return new AgentSession(client, session.id, session);
  }

  /**
   * The GitHub repositories the caller can hand a managed session: every
   * repository under an installation of Macro's GitHub App they or their
   * teams made, sorted by `owner/name`. Empty when the App is installed
   * nowhere they reach.
   */
  static async repositories(
    client: MacroClient
  ): Promise<SelectableRepository[]> {
    const { repositories } = unwrap(
      await client.agentHarness.listAgentRepositories()
    );
    return repositories.map((repository) => ({
      url: repository.url,
      defaultBranch: repository.defaultBranch ?? undefined,
    }));
  }

  /**
   * Branch names on one repository the caller can start a managed session
   * from, in the order GitHub listed them. Empty when the repository has
   * no commits yet. `repoUrl` is one of the URLs {@link AgentSession.repositories}
   * lists.
   */
  static async repositoryBranches(
    client: MacroClient,
    repoUrl: string
  ): Promise<string[]> {
    const { branches } = unwrap(
      await client.agentHarness.listAgentRepositoryBranches({
        query: { repoUrl },
      })
    );
    return branches;
  }

  protected async fetch(): Promise<AgentSessionResponse> {
    return unwrap(
      await this.client.agentHarness.getAgentSession({
        path: { session_id: this.id },
      })
    );
  }

  /** The session's user-facing display name. */
  readonly name = this.field('name');

  /** The model currently configured for the session. */
  readonly model = this.field('model');

  /** The agent harness implementation serving the session. */
  readonly harness = this.field('harness');

  /** The repository the agent works with, when one was supplied. */
  readonly repoUrl = this.field('repoUrl');

  /** The directory in which the agent harness runs. */
  readonly workspace = this.field('workspace');

  /**
   * Instructions the session's runtime works under, when any were stated at
   * creation. Fixed for the session's life.
   */
  readonly instructions = this.field('instructions');

  /** The session's latest runtime status. */
  readonly status = this.field('status');

  /** Compute tier of the managed sandbox. */
  readonly sandboxSize = this.field('sandboxSize');

  /** When the session was created. */
  readonly createdAt = this.field('createdAt');

  /** When the session was last modified. */
  readonly modifiedAt = this.field('modifiedAt');

  /** Rename this session. */
  async rename(name: string): Promise<void> {
    await this.mutate((client) =>
      client.agentHarness.renameAgentSession({
        path: { session_id: this.id },
        body: { name },
      })
    );
  }

  /** Resize this session's sandbox and remember the size as the owner's default. */
  async setSandboxSize(size: SandboxSize): Promise<SandboxSize> {
    const { size: next } = await this.mutate((client) =>
      client.agentHarness.putAgentSessionSandboxSize({
        path: { session_id: this.id },
        body: { size },
      })
    );
    return next;
  }

  /** The caller's default sandbox size for new `@coder` sessions. */
  static async defaultSandboxSize(client: MacroClient): Promise<SandboxSize> {
    return unwrap(await client.agentHarness.getAgentSandboxSize()).size;
  }

  /** Set the caller's default sandbox size for the next `@coder` mention. */
  static async setDefaultSandboxSize(
    client: MacroClient,
    size: SandboxSize
  ): Promise<SandboxSize> {
    return unwrap(
      await client.agentHarness.putAgentSandboxSize({
        body: { size },
      })
    ).size;
  }

  /**
   * Send a prompt or lifecycle operation to the live agent session.
   *
   * The returned `actionId` matches `requestId` on the folded message the
   * action derives once it dispatches. A `queued` status means a turn was
   * running: the action waits in the session's queue ({@link queue}) and
   * dispatches when that turn ends.
   */
  async control(action: AgentAction): Promise<ControlResponse> {
    return this.mutate((client) =>
      client.agentHarness.controlAgentSession({
        path: { session_id: this.id },
        body: action,
      })
    );
  }

  /**
   * Send a prompt to the session — sugar over {@link control}.
   *
   * `attachments` are files the prompt refers to, each by a URL the agent
   * can fetch (a static file service URL in practice); they reach the agent
   * as ACP `resource_link` blocks after the text.
   */
  prompt(
    text: string,
    attachments?: PromptAttachment[]
  ): Promise<ControlResponse> {
    return this.control({
      type: 'prompt',
      prompt: text,
      ...(attachments && attachments.length > 0 ? { attachments } : {}),
    });
  }

  /**
   * The actions waiting to dispatch in this session, oldest first. Each can
   * be edited or removed until it dispatches.
   */
  async queue(): Promise<QueuedAction[]> {
    const { entries } = unwrap(
      await this.client.agentHarness.getAgentSessionQueue({
        path: { session_id: this.id },
      })
    );
    return entries.map((entry) =>
      QueuedAction.from(this.client, this.id, entry)
    );
  }

  /** Read the latest captured GitHub pull request changes and capture status. */
  async changes(): Promise<AgentSessionChangesResponse> {
    return unwrap(
      await this.client.agentHarness.getAgentSessionChanges({
        path: { session_id: this.id },
      })
    );
  }

  /** Read the unified diff of the latest captured changeset. */
  async changesPatch(): Promise<string> {
    return unwrap(
      await this.client.agentHarness.getAgentSessionChangesPatch({
        path: { session_id: this.id },
      })
    ).patch;
  }

  /** Request a fresh capture and return the current state while it runs. */
  async refreshChanges(): Promise<AgentSessionChangesResponse> {
    return this.mutate((client) =>
      client.agentHarness.refreshAgentSessionChanges({
        path: { session_id: this.id },
      })
    );
  }

  /** Read the complete raw protocol log for this session. */
  async log(): Promise<AgentSessionLogResponse> {
    return unwrap(
      await this.client.agentHarness.getAgentSessionLog({
        path: { session_id: this.id },
      })
    );
  }

  /** Delete this session and any live resources it owns. */
  async delete(): Promise<void> {
    await this.mutate((client) =>
      client.agentHarness.deleteAgentSession({
        path: { session_id: this.id },
      })
    );
  }
}
