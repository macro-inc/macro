import { unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Agent, type AgentOptions, agentBody } from './agent';

/**
 * A coding agent the caller can start a session as right now: a built-in
 * persona such as Cursor once its runtime is connected, or one of their
 * configured coding agents whose runtime is reachable.
 */
export type CodingAgent = {
  /** Pass as `agent` to {@link AgentSessionNamespace.createManaged}. */
  agent: Agent;
  /** Display name. */
  name: string;
  /** What the persona is for, when known. */
  description: string | undefined;
  /** Saved guidance on its repositories and specialties; empty for built-ins. */
  instructions: string;
  /** Runtime its sessions run on, e.g. `cursor` or `macrod`. */
  harness: string;
  /** Default model, absent when the runtime chooses. */
  model: string | undefined;
};

/**
 * Agent personas: the built-in ones Macro ships and the agents the user configures.
 *
 * @routing Use when the user wants to pick, read or change one of their Macro agent personas: its instructions, model, runtime, channels, apps or hosts; not any request the user asks you, the agent, to carry out.
 */
export class AgentNamespace {
  constructor(private readonly client: MacroClient) {}

  /**
   * A lazy handle to a configurable agent. Get handles from
   * {@link AgentNamespace.list} or {@link AgentNamespace.coding} instead of
   * constructing one from an id.
   */
  byId(id: string): Agent {
    return Agent.byId(this.client, id);
  }

  /**
   * The configurable agents the user can manage (their own, their teams', and
   * channel agents they can mention), coding and chat, with their full
   * settings. Built-in personas such as Cursor are not here; list those with
   * {@link AgentNamespace.coding}. Pass one as `agent` to
   * {@link AgentSessionNamespace.createManaged} to start a session as it.
   *
   * @readonly
   */
  async list(): Promise<Agent[]> {
    return unwrap(await this.client.storage.listAgents()).map((a) =>
      Agent.from(this.client, a),
    );
  }

  /**
   * Choose a coding agent from this list before delegating coding work: the
   * coding personas the user can start a session as right now, built-in ones
   * such as Cursor first, then their configured coding agents whose runtime
   * is connected. Prefer the agent the user named, otherwise the one whose
   * name, description, instructions and runtime best fit the repository and
   * task, and pass its `agent` to {@link AgentSessionNamespace.createManaged}.
   * Empty when nothing is connected; tell the user to connect Cursor or
   * configure a coding agent. Macro's own default persona is not listed:
   * omit `agent` to use it.
   *
   * @readonly
   */
  async coding(): Promise<CodingAgent[]> {
    const { agents } = unwrap(
      await this.client.agentHarness.listCodingAgents(),
    );
    return agents.map((agent) => ({
      agent: Agent.byId(this.client, agent.id),
      name: agent.name,
      description: agent.description ?? undefined,
      instructions: agent.instructions,
      harness: agent.harness,
      model: agent.model ?? undefined,
    }));
  }

  /**
   * Create an agent.
   *
   * @write
   */
  async create(options: AgentOptions): Promise<Agent> {
    return Agent.from(
      this.client,
      unwrap(
        await this.client.storage.createAgent({ body: agentBody(options) }),
      ),
    );
  }
}
