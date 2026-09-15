import {
  CURSOR_BOT_HANDLE,
  CURSOR_BOT_ID,
  CURSOR_BOT_NAME,
} from '@core/constant/cursorAgent';
import {
  MACRO_AGENT_HANDLE,
  MACRO_AGENT_NAME,
} from '@core/constant/macroAgent';
import {
  MACRO_CODER_BOT_ID,
  MACRO_CODER_HANDLE,
  MACRO_CODER_NAME,
} from '@core/constant/macroCoder';
import { type AgentKind, kindForHarness, kindForMode } from './agent-kind';
import type { AgentsMode } from './mode';

/**
 * Macro's own chat agent: the deployment's managed default. Started without a
 * `botId`, so the server picks the runtime it is configured to run it on.
 */
export const MACRO_PERSONA_ID = 'macro';

/** The fields of a persisted agent the roster reads. Structural, so the wire
 *  type satisfies it without the core importing the client. */
export type PersistedAgentLike = {
  bot: {
    id: string;
    name: string;
    handle: string;
    description?: string | null;
    avatar_url?: string | null;
    created_by?: string | null;
    owner?:
      | { type: 'user'; user_id: string }
      | { type: 'team'; team_id: string }
      | null;
  };
  harness: string;
  harness_id?: string | null;
  default_model: string;
};

/** A registered macrod runtime, as far as the roster cares. */
export type RuntimeLike = {
  id: string;
  name: string;
  connected: boolean;
};

export type RosterShare = 'system' | 'team' | 'private';

/** One agent or coder as the composer, carousel, and roster page show it. */
export type RosterAgent = {
  /** Persona id: the bot id, or `MACRO_PERSONA_ID` for Macro's default. */
  id: string;
  /** Bot to start sessions for; absent for Macro's default persona. */
  botId?: string;
  kind: AgentKind;
  name: string;
  handle: string;
  description?: string;
  avatarUrl?: string;
  harness: string;
  harnessId?: string;
  defaultModel?: string;
  share: RosterShare;
  /** Where it runs, as a person would say it, and whether that is reachable. */
  runtime: { label: string; connected: boolean };
  ownerId?: string;
  /** Why it cannot be started from the composer right now, when it cannot. */
  unavailableReason?: string;
  /** An unavailable agent with a setup action stays clickable. */
  connectLabel?: string;
  /** The persisted record behind a user-made agent; absent for system ones. */
  persisted?: PersistedAgentLike;
};

export type RosterInput = {
  agents: readonly PersistedAgentLike[];
  runtimes: readonly RuntimeLike[];
  cursorConnected: boolean;
  /** Cursor's status is known and it is not connected, so offer to connect. */
  cursorNeedsConnection: boolean;
  macroDefaultModel?: string;
  cursorDefaultModel?: string;
};

/** The product name of a runtime, from the harness slug bots are stored with. */
export function runtimeLabel(
  harness: string,
  harnessId: string | undefined,
  runtimes: readonly RuntimeLike[]
): string {
  switch (harness) {
    case 'in-memory':
    case 'macro-inmem':
      return 'Macro';
    case 'cursor':
      return 'Cursor';
    case 'macrod':
      return (
        runtimes.find((runtime) => runtime.id === harnessId)?.name ??
        'Disconnected runtime'
      );
    default:
      return harness;
  }
}

function runtimeConnected(
  harness: string,
  harnessId: string | undefined,
  input: Pick<RosterInput, 'runtimes' | 'cursorConnected'>
): boolean {
  switch (harness) {
    case 'in-memory':
    case 'macro-inmem':
      return true;
    case 'cursor':
      return input.cursorConnected;
    case 'macrod':
      return (
        input.runtimes.find((runtime) => runtime.id === harnessId)?.connected ??
        false
      );
    default:
      return false;
  }
}

/**
 * Harness slugs whose runtimes this deployment provisions itself — the only
 * personas the composer can start. A persona on a registered macrod daemon
 * opens its own sessions from a channel mention, so the composer lists it but
 * cannot start it.
 */
function startableFromComposer(harness: string): boolean {
  return (
    harness === 'in-memory' || harness === 'macro-inmem' || harness === 'cursor'
  );
}

function persistedAgent(
  agent: PersistedAgentLike,
  input: RosterInput
): RosterAgent {
  const harnessId = agent.harness_id ?? undefined;
  const connected = runtimeConnected(agent.harness, harnessId, input);
  const startable = startableFromComposer(agent.harness);
  return {
    id: agent.bot.id,
    botId: agent.bot.id,
    kind: kindForHarness(agent.harness),
    name: agent.bot.name,
    handle: agent.bot.handle,
    description: agent.bot.description ?? undefined,
    avatarUrl: agent.bot.avatar_url ?? undefined,
    harness: agent.harness,
    harnessId,
    defaultModel: agent.default_model,
    share: agent.bot.owner?.type === 'team' ? 'team' : 'private',
    runtime: {
      label: runtimeLabel(agent.harness, harnessId, input.runtimes),
      connected,
    },
    ownerId:
      agent.bot.owner?.type === 'user'
        ? agent.bot.owner.user_id
        : (agent.bot.created_by ?? undefined),
    unavailableReason: startable
      ? undefined
      : connected
        ? 'Runs on its own machine · start it from a channel mention'
        : 'Its runtime is disconnected',
    persisted: agent,
  };
}

/**
 * Everyone the composer can pick from: the first-party agents lead, then the
 * saved ones the caller can start (their own, team-shared, and the ones they
 * can `@` mention).
 */
export function buildAgentRoster(input: RosterInput): RosterAgent[] {
  return [
    {
      id: MACRO_PERSONA_ID,
      kind: 'agent',
      name: MACRO_AGENT_NAME,
      handle: MACRO_AGENT_HANDLE,
      harness: 'in-memory',
      defaultModel: input.macroDefaultModel,
      share: 'system',
      runtime: { label: 'Macro', connected: true },
    },
    {
      id: MACRO_CODER_BOT_ID,
      botId: MACRO_CODER_BOT_ID,
      kind: 'coder',
      name: MACRO_CODER_NAME,
      handle: MACRO_CODER_HANDLE,
      description:
        'Writes code in a sandbox Macro provisions for each session.',
      harness: 'sandbox',
      share: 'system',
      runtime: { label: 'Macro sandbox', connected: true },
    },
    {
      id: CURSOR_BOT_ID,
      botId: CURSOR_BOT_ID,
      kind: 'coder',
      name: CURSOR_BOT_NAME,
      handle: CURSOR_BOT_HANDLE,
      description: 'Cursor cloud agents, run with your Cursor account.',
      harness: 'cursor',
      defaultModel: input.cursorDefaultModel,
      share: 'system',
      runtime: { label: 'Cursor', connected: input.cursorConnected },
      unavailableReason: input.cursorConnected
        ? undefined
        : 'Connect Cursor to start it',
      connectLabel: input.cursorNeedsConnection ? 'Connect Cursor' : undefined,
    },
    ...input.agents.map((agent) => persistedAgent(agent, input)),
  ];
}

/** The half of the roster a mode shows. */
export function rosterForMode(
  roster: readonly RosterAgent[],
  mode: AgentsMode
): RosterAgent[] {
  const kind = kindForMode(mode);
  return roster.filter((agent) => agent.kind === kind);
}

/**
 * The kind of the bot behind a session: fixed for first-party bots, read from
 * the harness for saved agents, and Chat for anything the roster cannot see
 * (a teammate's private agent, or one since deleted).
 */
export function kindForBot(
  botId: string | null | undefined,
  roster: readonly RosterAgent[]
): AgentKind {
  if (!botId) return 'agent';
  const bare = botId.startsWith('bot|') ? botId.slice('bot|'.length) : botId;
  return roster.find((agent) => agent.botId === bare)?.kind ?? 'agent';
}
