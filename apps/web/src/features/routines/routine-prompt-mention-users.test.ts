import { MACRO_AGENT_PRINCIPAL_ID } from '@core/constant/macroAgent';
import type { BotIdentity } from '@queries/bots/graphql-bots';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useRoutinePromptMentionUsers } from './routine-prompt-mention-users';

const state = vi.hoisted(() => ({
  agents: undefined as BotIdentity[] | undefined,
  scope: undefined as string | null | undefined,
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
vi.mock('@queries/bots/graphql-bots', () => ({
  createMentionableBots: (scope: () => string | null | undefined) => {
    state.scope = scope();
    return { bots: () => state.agents ?? [] };
  },
}));

function savedAgent(id: string, name: string): BotIdentity {
  return {
    id,
    name,
    handle: id,
    avatarUrl: undefined,
    deleted: false,
    isSystem: false,
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

      state.agents = [savedAgent('saved-agent', 'Saved')];
      expect(users().map((user) => user.id)).toEqual([
        'macro|person@example.com',
        MACRO_AGENT_PRINCIPAL_ID,
        'bot|saved-agent',
      ]);
      // Every agent the viewer can start, not one channel's.
      expect(state.scope).toBeNull();
      dispose();
    });
  });

  it('leaves an agent whose runtime is away pickable', () => {
    createRoot((dispose) => {
      state.agents = [savedAgent('offline-agent', 'Away')];
      const users = useRoutinePromptMentionUsers();
      expect(
        users().find((user) => user.id === 'bot|offline-agent')?.offline
      ).toBeUndefined();
      dispose();
    });
  });
});
