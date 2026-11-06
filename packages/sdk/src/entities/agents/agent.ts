import type {
  AgentMemory as AgentMemoryRecord,
  Agent as AgentRecord,
  CreateAgentRequest,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { MacroEntity } from '../entity';
import { Harness } from '../harnesses/harness';
import type { Team } from '../teams/team';

/** Agent creation and replacement settings. */
export type AgentOptions = Omit<
  CreateAgentRequest,
  | 'channel_ids'
  | 'team_id'
  | 'harness_id'
  | 'auto_accept_permissions'
  | 'avatar_url'
  | 'channel_scope'
  | 'default_model'
  | 'is_coding'
> & {
  /** Channels the agent can access. */
  channels?: Channel[];
  /** Owning team. */
  team?: Team;
  /** Host running the agent. */
  host?: Harness;
  /** Whether tool permissions are automatically accepted. */
  autoAcceptPermissions?: boolean;
  /** Avatar URL. */
  avatarUrl?: string;
  /** Channel visibility policy. */
  channelScope: CreateAgentRequest['channel_scope'];
  /** Default model. */
  defaultModel: string;
  /** Whether this is a coding agent. */
  isCoding: boolean;
};

/** What an agent remembers across its sessions, whoever starts them. */
export type AgentMemory = {
  /** The remembered markdown; empty before anything is remembered. */
  content: string;
  /** The revision to pass to the next {@link Agent.updateMemory}; 0 before the first write. */
  revision: number;
  /** When the memory last changed; undefined before the first write. */
  updatedAt: string | undefined;
};

/** A configurable agent backed by a bot identity. */
export class Agent extends MacroEntity<AgentRecord> {
  /** Construct a lazy agent handle. */
  static byId(client: MacroClient, id: string): Agent {
    return new Agent(client, id);
  }

  /** Seed from a listed or created agent. */
  static from(client: MacroClient, record: AgentRecord): Agent {
    return new Agent(client, record.bot.id, record);
  }

  protected async fetch(): Promise<AgentRecord> {
    const record = unwrap(await this.client.storage.listAgents()).find(
      (a) => a.bot.id === this.id,
    );
    if (!record)
      throw new MacroNotFoundError(`Agent ${this.id} is unavailable`);
    return record;
  }

  /** Display name. */
  readonly name = this.mappedField('bot', (bot) => bot.name);

  /** Agent instructions. */
  readonly instructions = this.field('instructions');

  /** Default model. */
  readonly defaultModel = this.field('default_model');

  /** Visible channels. */
  readonly channels = this.mappedField('channel_ids', (ids) =>
    ids.map((id) => Channel.byId(this.client, id)),
  );

  /** Host running this agent. */
  readonly host = this.mappedField('harness_id', (id) =>
    id ? Harness.byId(this.client, id) : undefined,
  );

  /** What the agent remembers across its sessions, and its revision. */
  async memory(): Promise<AgentMemory> {
    return agentMemory(
      unwrap(
        await this.client.storage.getAgentMemory({
          path: { agent_id: this.id },
        }),
      ),
    );
  }

  /**
   * Replace what the agent remembers, whole. Fails without changing anything
   * when the memory is no longer at `revision`, as when the agent remembered
   * something since it was read: read it again and reconcile.
   */
  async updateMemory(content: string, revision: number): Promise<AgentMemory> {
    return agentMemory(
      unwrap(
        await this.client.storage.updateAgentMemory({
          path: { agent_id: this.id },
          body: { content, revision },
        }),
      ),
    );
  }

  /** Replace agent settings. */
  async update(options: AgentOptions): Promise<void> {
    await this.mutate((c) =>
      c.storage.updateAgent({
        path: { agent_id: this.id },
        body: agentBody(options),
      }),
    );
  }
}

function agentMemory(record: AgentMemoryRecord): AgentMemory {
  return {
    content: record.content,
    revision: record.revision,
    updatedAt: record.updated_at ?? undefined,
  };
}

/** Convert entity references into the generated agent request. */
export function agentBody(options: AgentOptions): CreateAgentRequest {
  const {
    channels,
    team,
    host,
    autoAcceptPermissions,
    avatarUrl,
    channelScope,
    defaultModel,
    isCoding,
    ...rest
  } = options;
  return {
    ...rest,
    channel_ids: channels?.map((c) => c.id),
    team_id: team?.id,
    harness_id: host?.id,
    auto_accept_permissions: autoAcceptPermissions,
    avatar_url: avatarUrl,
    channel_scope: channelScope,
    default_model: defaultModel,
    is_coding: isCoding,
  };
}
