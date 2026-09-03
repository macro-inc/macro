import type {
  AgentAction,
  AgentSessionLogResponse,
  AgentSessionResponse,
  ControlResponse,
  SandboxSize,
} from '../../../generated/agent-harness/types.gen';
import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { MacroEntity } from '../entity';
import { QueuedAction } from './queued-action';

/** A managed or externally hosted coding-agent session. */
export class AgentSession extends MacroEntity<AgentSessionResponse> {
  /** A handle to an agent session by id. Details load on first access. */
  static byId(client: MacroClient, id: string): AgentSession {
    return new AgentSession(client, id);
  }

  /** Create a managed session, optionally delivering its first prompt. */
  static async createManaged(
    client: MacroClient,
    opts?: { prompt?: string; instructions?: string },
  ): Promise<AgentSession> {
    const { session } = unwrap(
      await client.agentHarness.createAgentSession({
        body: { prompt: opts?.prompt, instructions: opts?.instructions },
      }),
    );
    return new AgentSession(client, session.id, session);
  }

  protected async fetch(): Promise<AgentSessionResponse> {
    return unwrap(
      await this.client.agentHarness.getAgentSession({
        path: { session_id: this.id },
      }),
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
      }),
    );
  }

  /** Resize this session's sandbox and remember the size as the owner's default. */
  async setSandboxSize(size: SandboxSize): Promise<SandboxSize> {
    const { size: next } = await this.mutate((client) =>
      client.agentHarness.putAgentSessionSandboxSize({
        path: { session_id: this.id },
        body: { size },
      }),
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
    size: SandboxSize,
  ): Promise<SandboxSize> {
    return unwrap(
      await client.agentHarness.putAgentSandboxSize({
        body: { size },
      }),
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
      }),
    );
  }

  /** Send a prompt to the session — sugar over {@link control}. */
  prompt(text: string): Promise<ControlResponse> {
    return this.control({ type: 'prompt', prompt: text });
  }

  /**
   * The actions waiting to dispatch in this session, oldest first. Each can
   * be edited or removed until it dispatches.
   */
  async queue(): Promise<QueuedAction[]> {
    const { entries } = unwrap(
      await this.client.agentHarness.getAgentSessionQueue({
        path: { session_id: this.id },
      }),
    );
    return entries.map((entry) =>
      QueuedAction.from(this.client, this.id, entry),
    );
  }

  /** Read the complete raw protocol log for this session. */
  async log(): Promise<AgentSessionLogResponse> {
    return unwrap(
      await this.client.agentHarness.getAgentSessionLog({
        path: { session_id: this.id },
      }),
    );
  }

  /** Delete this session and any live resources it owns. */
  async delete(): Promise<void> {
    await this.mutate((client) =>
      client.agentHarness.deleteAgentSession({
        path: { session_id: this.id },
      }),
    );
  }
}
