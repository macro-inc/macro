import { MACRO_NEW_PRINCIPAL_ID } from '@core/constant/macroNew';
import type { IUser } from '@core/user/types';
import type { Agent } from '@service-storage/generated/schemas/agent';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  agents: [] as Agent[],
  bots: [] as Bot[],
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableCodexAgents: { key: 'enable-codex-agents' },
  enableCursorAgents: { key: 'enable-cursor-agents' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({
    isPending: false,
    get data() {
      return fixture.agents;
    },
  }),
}));
vi.mock('@queries/bots/bots', () => ({
  useBotsQuery: () => ({
    isPending: false,
    get data() {
      return fixture.bots;
    },
  }),
}));

import { useOwnAgentMentionTransform } from './use-own-agent-mention-users';

function agent(id: string, name: string): Agent {
  return {
    bot: {
      id,
      name,
      handle: name.toLowerCase(),
      kind: 'owned',
      has_agent: true,
      created_at: '',
      updated_at: '',
    },
    harness: 'in-memory',
    instructions: '',
    default_model: '',
    channel_ids: [],
    channel_scope: 'all',
    mcp: { scope: 'owner_connections' },
    is_coding: false,
  };
}

const noContacts: IUser[] = [];

function mentionable(contacts: IUser[]): string[] {
  return createRoot((dispose) => {
    const ids = useOwnAgentMentionTransform()(contacts).map(({ id }) => id);
    dispose();
    return ids;
  });
}

beforeEach(() => {
  fixture.agents = [];
  fixture.bots = [];
});

describe('agents mentionable without contacts', () => {
  it('offers Macro to an account with no contacts and no agents', () => {
    expect(mentionable(noContacts)).toEqual([MACRO_NEW_PRINCIPAL_ID]);
  });

  it('offers the agents of the viewer’s teams next to Macro', () => {
    const team = agent('team-agent', 'Sage');
    fixture.agents = [team];
    fixture.bots = [team.bot];
    expect(mentionable(noContacts)).toEqual([
      MACRO_NEW_PRINCIPAL_ID,
      'bot|team-agent',
    ]);
  });

  it('offers an agent as soon as it is created', () => {
    expect(mentionable(noContacts)).not.toContain('bot|fresh');
    const fresh = agent('fresh', 'Fresh');
    fixture.agents = [fresh];
    fixture.bots = [fresh.bot];
    expect(mentionable(noContacts)).toContain('bot|fresh');
  });

  it('leaves out agents of teams the viewer is not in', () => {
    const mine = agent('mine', 'Mine');
    const foreign = agent('foreign', 'Foreign');
    // The agent list includes agents seen through shared channels; the bot
    // list holds only the viewer's own and team bots.
    fixture.agents = [mine, foreign];
    fixture.bots = [mine.bot];
    const ids = mentionable(noContacts);
    expect(ids).toContain('bot|mine');
    expect(ids).not.toContain('bot|foreign');
  });

  it('lists an agent once when contacts already have it', () => {
    const team = agent('team-agent', 'Sage');
    fixture.agents = [team];
    fixture.bots = [team.bot];
    const contact: IUser = {
      id: 'bot|team-agent',
      name: 'Sage',
      email: 'Sage',
    };
    const ids = mentionable([contact]);
    expect(ids.filter((id) => id === 'bot|team-agent')).toHaveLength(1);
  });
});
