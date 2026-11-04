import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoutinePromptMentionUsers } from './routine-prompt-mention-users';

const state = vi.hoisted(() => ({
  agents: undefined as unknown[] | undefined,
  people: [] as { data: { id: string; name: string; email: string } }[],
}));

vi.mock('@core/context/quickAccess', () => ({
  useQuickAccess: () => ({
    useList: () => ({ items: () => state.people }),
  }),
}));
vi.mock('@core/cursor/flag', () => ({
  useCursorAgentsAccess: () => () => false,
}));
vi.mock('@core/codex/flag', () => ({
  useCodexAgentsAccess: () => () => false,
}));
vi.mock('@channel/use-chat-v3-agents-flag', () => ({
  useChatV3AgentsFlag: () => () => false,
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({
    get data() {
      return state.agents;
    },
  }),
}));
vi.mock('@queries/agents/offline-runtimes', () => ({
  useOfflineAgentBotIds: () => () => new Set(['offline-agent']),
}));
vi.mock('@queries/channel/channel-bots', () => ({
  useChannelBotsQuery: () => ({ data: [] }),
}));
vi.mock('@queries/gate', () => ({
  queryReadyGate: (query: { data?: unknown }) => query.data !== undefined,
}));

function savedAgent(id: string, name: string, channelScope: string) {
  return {
    channel_scope: channelScope,
    bot: { id, name, has_agent: true },
  };
}

describe('useRoutinePromptMentionUsers', () => {
  beforeEach(() => {
    state.agents = undefined;
    state.people = [
      {
        data: {
          id: 'macro|person@example.com',
          name: 'Person',
          email: 'person@example.com',
        },
      },
    ];
  });

  it('keeps people while agents load, then offers their saved agents', () => {
    createRoot((dispose) => {
      const users = useRoutinePromptMentionUsers();
      expect(users().map((user) => user.id)).toEqual([
        'macro|person@example.com',
        MACRO_AGENT_PRINCIPAL_ID,
      ]);

      state.agents = [savedAgent('saved-agent', 'Saved', 'none')];
      expect(users().map((user) => user.id)).toEqual([
        'macro|person@example.com',
        MACRO_AGENT_PRINCIPAL_ID,
        'bot|saved-agent',
      ]);
      dispose();
    });
  });

  it('leaves an agent whose runtime is away pickable', () => {
    createRoot((dispose) => {
      state.agents = [savedAgent('offline-agent', 'Away', 'all')];
      const users = useRoutinePromptMentionUsers();
      expect(
        users().find((user) => user.id === 'bot|offline-agent')?.offline
      ).toBeUndefined();
      dispose();
    });
  });
});
