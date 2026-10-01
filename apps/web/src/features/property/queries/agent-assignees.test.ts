import { CLAUDE_BOT_PRINCIPAL_ID } from '@core/constant/claudeAgent';
import { CODEX_BOT_PRINCIPAL_ID } from '@core/constant/codexAgent';
import { CURSOR_BOT_PRINCIPAL_ID } from '@core/constant/cursorAgent';
import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import { MACRO_CODER_PRINCIPAL_ID } from '@core/constant/macroCoder';
import { MACRO_NEW_PRINCIPAL_ID } from '@core/constant/macroNew';
import type { Agent } from '@service-storage/generated/schemas/agent';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  agents: [] as Agent[],
  bots: [] as Bot[],
  pending: false,
  agentRollout: false,
  cursorRollout: false,
}));

vi.mock('@core/constant/featureFlags', () => ({
  enableChatV3Agents: { key: 'enable-chat-v3-agents' },
  enableCursorAgents: { key: 'enable-cursor-agents' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      flag.key === 'enable-chat-v3-agents'
        ? fixture.agentRollout
        : fixture.cursorRollout,
  }),
}));

vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({
    get isPending() {
      return fixture.pending;
    },
    get data() {
      if (fixture.pending)
        throw new Error('Pending agent data must not be read');
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

import { useAgentAssignees } from './agent-assignees';

function agent(id: string, overrides: Partial<Bot> = {}): Agent {
  return {
    bot: {
      id,
      name: 'Research agent',
      handle: 'research',
      kind: 'owned',
      has_agent: true,
      created_at: '',
      updated_at: '',
      ...overrides,
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

beforeEach(() => {
  fixture.agents = [];
  fixture.bots = [];
  fixture.pending = false;
  fixture.agentRollout = false;
  fixture.cursorRollout = false;
});

describe('task agent assignees', () => {
  it('offers owned and team agents as bot principals, excluding channel-only and non-agent bots', () => {
    const owned = agent('owned', {
      avatar_url: 'https://example.com/avatar.png',
    });
    const team = agent('team');
    const channelOnly = agent('channel-only');
    const inactive = agent('inactive', { has_agent: false });
    const deleted = agent('deleted', { deleted_at: '2026-01-01' });
    fixture.agents = [owned, team, channelOnly, inactive, deleted];
    fixture.bots = [owned.bot, team.bot, inactive.bot, deleted.bot];
    createRoot((dispose) => {
      const users = useAgentAssignees(() => true);
      expect(users().map(({ id }) => id)).toEqual([
        CLAUDE_BOT_PRINCIPAL_ID,
        CODEX_BOT_PRINCIPAL_ID,
        'bot|owned',
        'bot|team',
      ]);
      expect(users().find(({ id }) => id === 'bot|owned')).toEqual({
        id: 'bot|owned',
        name: 'Research agent',
        email: '@research',
        photoUrl: 'https://example.com/avatar.png',
      });
      dispose();
    });
  });

  it('does not suspend people selection while agents are pending, or expose agents to other properties', () => {
    fixture.pending = true;
    createRoot((dispose) => {
      expect(useAgentAssignees(() => true)().map(({ id }) => id)).toEqual([
        CLAUDE_BOT_PRINCIPAL_ID,
        CODEX_BOT_PRINCIPAL_ID,
      ]);
      expect(useAgentAssignees(() => false)()).toEqual([]);
      dispose();
    });
  });

  it('reuses system session-agent rollout and excludes classic Macro', () => {
    fixture.agentRollout = true;
    fixture.cursorRollout = true;
    createRoot((dispose) => {
      const ids = useAgentAssignees(() => true)().map(({ id }) => id);
      expect(ids).toEqual([
        MACRO_NEW_PRINCIPAL_ID,
        CLAUDE_BOT_PRINCIPAL_ID,
        CODEX_BOT_PRINCIPAL_ID,
        CURSOR_BOT_PRINCIPAL_ID,
        MACRO_CODER_PRINCIPAL_ID,
      ]);
      expect(ids).not.toContain(MACRO_AGENT_PRINCIPAL_ID);
      dispose();
    });
  });
});
