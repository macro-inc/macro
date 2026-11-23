import { match } from 'ts-pattern';
import type {
  AgentMcpServers,
  Agent as AgentRecord,
  CreateAgentRequest,
  PatchAgentRequest,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import { Channel } from '../channels/channel';
import { MacroEntity } from '../entity';
import { Harness } from '../harnesses/harness';
import type { Team } from '../teams/team';

/**
 * The settings {@link Agent.update} changes; each one left out keeps its
 * current value.
 */
export type AgentPatch = {
  /** New instructions, whole. */
  instructions?: string;
  /**
   * New runtime: `in-memory`, `cursor`, or `macrod` with the registered
   * `host` that serves it. The current model may not exist on the new
   * runtime, so usually pass `defaultModel` with it.
   */
  runtime?: { harness: string; host?: Harness };
  /** New default model, as the runtime names it. */
  defaultModel?: string;
  /** Mentionable in every channel, or only in `channels`. */
  channels?: { scope: 'all' } | { scope: 'selected'; channels: Channel[] };
  /** The connected apps its sessions are handed. */
  apps?: AgentApps;
  /** Approve tool permission requests without asking, where the runtime allows it. */
  autoAcceptPermissions?: boolean;
  /** A coding agent (`true`) or a chat agent (`false`). */
  isCoding?: boolean;
};

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

/** The connected apps an agent's sessions are handed. */
export type AgentApps =
  | {
      /** Whatever apps the person running the session has connected. */
      scope: 'owner_connections';
    }
  | {
      /** Exactly `servers`. */
      scope: 'selected';
      /** The apps, in the order the agent's author picked them. */
      servers: {
        /** Pipedream app slug, e.g. `linear`. */
        appSlug: string;
        /** Display name, e.g. `Linear`. */
        name: string;
      }[];
    };

/**
 * An agent persona backed by a bot identity. Its settings load from
 * {@link AgentNamespace.list}, so they exist only for configurable agents;
 * built-in personas such as Cursor have none, and are listed with
 * {@link AgentNamespace.coding}.
 */
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
      throw new MacroNotFoundError(
        `Agent ${this.id} is not a configurable agent you can manage. Built-in personas such as Cursor have no settings; read the coding personas you can start with agents.coding().`,
      );
    return record;
  }

  /** Display name. */
  readonly name = this.mappedField('bot', (bot) => bot.name);

  /** Handle people `@` mention it by. */
  readonly handle = this.mappedField('bot', (bot) => bot.handle);

  /** What the agent is for, when its author said. */
  readonly description = this.mappedField(
    'bot',
    (bot) => bot.description ?? undefined,
  );

  /**
   * Runtime its sessions run on: `in-memory` (Macro), `cursor`,
   * `codex-cloud`, or `macrod` (a registered machine, named by
   * {@link Agent.host}).
   */
  readonly harness = this.field('harness');

  /**
   * Whether it is a coding agent, which works in a repository and answers a
   * mention with a live session, rather than a chat agent replying in the
   * thread.
   */
  readonly isCoding = this.field('is_coding');

  /**
   * Whether its sessions approve tool permission requests without asking,
   * where the runtime allows it.
   */
  readonly autoAcceptPermissions = this.mappedField(
    'auto_accept_permissions',
    (accept) => accept ?? false,
  );

  /** `all`: mentionable everywhere; `selected`: only in {@link Agent.channels}. */
  readonly channelScope = this.field('channel_scope');

  /** The connected apps its sessions are handed. */
  readonly apps = this.mappedField('mcp', agentApps);

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

  /**
   * Change only the settings in `patch`; every setting left out keeps its
   * current value. Instructions, channel and app lists are replaced whole:
   * to edit one, apply your change to the current value and pass the result.
   * Changes apply to sessions opened afterwards. Built-in personas cannot be
   * updated.
   *
   * @write
   * @idempotent
   */
  async update(patch: AgentPatch): Promise<void> {
    await this.mutate((c) =>
      c.storage.patchAgent({
        path: { agent_id: this.id },
        body: agentPatchBody(patch),
      }),
    );
  }

  /**
   * Replace every setting, including the name, handle and owning team:
   * fields left out of `options` return to their defaults. Use
   * {@link Agent.update} to change some settings and keep the rest.
   *
   * @destructive
   * @idempotent
   */
  async replace(options: AgentOptions): Promise<void> {
    await this.mutate((c) =>
      c.storage.updateAgent({
        path: { agent_id: this.id },
        body: agentBody(options),
      }),
    );
  }
}

function agentPatchBody(patch: AgentPatch): PatchAgentRequest {
  const body: PatchAgentRequest = {};
  if (patch.instructions !== undefined) body.instructions = patch.instructions;
  if (patch.runtime !== undefined) {
    body.harness = {
      harness: patch.runtime.harness,
      harness_id: patch.runtime.host?.id,
    };
  }
  if (patch.defaultModel !== undefined) body.default_model = patch.defaultModel;
  if (patch.channels !== undefined) {
    body.channels = match(patch.channels)
      .with({ scope: 'all' }, () => ({
        channel_scope: 'all' as const,
        channel_ids: [],
      }))
      .with({ scope: 'selected' }, ({ channels }) => ({
        channel_scope: 'selected' as const,
        channel_ids: channels.map((channel) => channel.id),
      }))
      .exhaustive();
  }
  if (patch.apps !== undefined) {
    body.mcp = match(patch.apps)
      .with({ scope: 'owner_connections' }, ({ scope }) => ({ scope }))
      .with({ scope: 'selected' }, ({ scope, servers }) => ({
        scope,
        servers: servers.map((server) => ({
          app_slug: server.appSlug,
          server_name: server.name,
        })),
      }))
      .exhaustive();
  }
  if (patch.autoAcceptPermissions !== undefined) {
    body.auto_accept_permissions = patch.autoAcceptPermissions;
  }
  if (patch.isCoding !== undefined) body.is_coding = patch.isCoding;
  return body;
}

function agentApps(mcp: AgentMcpServers): AgentApps {
  return match(mcp)
    .with({ scope: 'owner_connections' }, ({ scope }) => ({ scope }))
    .with({ scope: 'selected' }, ({ scope, servers }) => ({
      scope,
      servers: servers.map((server) => ({
        appSlug: server.app_slug,
        name: server.server_name,
      })),
    }))
    .exhaustive();
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
