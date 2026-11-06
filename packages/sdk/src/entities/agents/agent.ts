import type {
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
  | 'workspace_path'
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
  /**
   * Directory on `host` new sessions use, one of its reported workspaces.
   * Omit to use the host's workspace.
   */
  workspacePath?: string;
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

  /** Directory on the host new sessions use; `undefined` uses the host's. */
  readonly workspacePath = this.mappedField(
    'workspace_path',
    (path) => path ?? undefined,
  );

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

/** Convert entity references into the generated agent request. */
export function agentBody(options: AgentOptions): CreateAgentRequest {
  const {
    channels,
    team,
    host,
    workspacePath,
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
    workspace_path: workspacePath,
    auto_accept_permissions: autoAcceptPermissions,
    avatar_url: avatarUrl,
    channel_scope: channelScope,
    default_model: defaultModel,
    is_coding: isCoding,
  };
}
