import type { Agent } from '@service-storage/generated/schemas/agent';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  availableBotMentionUsers,
  useChannelBotMentionUsers,
} from './use-channel-bot-mention-users';

vi.mock('@queries/channel/channel-bots', () => ({
  useChannelBotsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({
    isSuccess: true,
    data: [agent('codex-agent', 'Codex', 'all', 'codex-cloud')],
  }),
}));

const timestamp = '2026-08-27T12:00:00Z';

function bot(id: string, name: string, avatarUrl?: string): Bot {
  return {
    id,
    kind: 'owned',
    name,
    handle: name.toLowerCase().replaceAll(' ', '-'),
    has_agent: true,
    avatar_url: avatarUrl,
    created_at: timestamp,
    updated_at: timestamp,
  };
}

function agent(
  id: string,
  name: string,
  channelScope: Agent['channel_scope'],
  harness = 'in-memory'
): Agent {
  return {
    bot: bot(id, name),
    channel_ids: channelScope === 'all' ? [] : ['channel-1'],
    channel_scope: channelScope,
    default_model: 'model',
    harness,
    instructions: '',
    mcp: { scope: 'owner_connections' },
  };
}

describe('availableBotMentionUsers', () => {
  it('offers Codex from the mention query without requiring account setup', () => {
    createRoot((dispose) => {
      expect(
        useChannelBotMentionUsers(() => 'channel-1')().map((user) => user.id)
      ).toEqual(['bot|codex-agent']);
      dispose();
    });
  });
  it.each(['cursor', 'codex-cloud', 'claude-cloud'])(
    'offers global and installed %s agents before connection',
    (harness) => {
      const global = agent('global', 'Global', 'all', harness);
      const installed = agent('installed', 'Installed', 'selected', harness);
      expect(
        availableBotMentionUsers([installed.bot], [global, installed]).map(
          (user) => user.id
        )
      ).toEqual(['bot|installed', 'bot|global']);
    }
  );
  it('adds all-channel agents without adding selected agents from other channels', () => {
    expect(
      availableBotMentionUsers(
        [bot('installed', 'Installed')],
        [
          agent('global', 'Global', 'all'),
          agent('selected', 'Selected', 'selected'),
        ]
      ).map((user) => user.id)
    ).toEqual(['bot|installed', 'bot|global']);
  });

  it('deduplicates an agent that is also an installed channel bot', () => {
    expect(
      availableBotMentionUsers(
        [bot('global', 'Global')],
        [agent('global', 'Global', 'all')]
      )
    ).toHaveLength(1);
  });

  it('preserves the agent avatar for the mention menu', () => {
    const avatarUrl = 'https://example.com/global-agent.png';

    expect(
      availableBotMentionUsers(
        [],
        [
          {
            ...agent('global', 'Global', 'all'),
            bot: bot('global', 'Global', avatarUrl),
          },
        ]
      )
    ).toEqual([
      {
        id: 'bot|global',
        name: 'Global',
        email: 'Global',
        photoUrl: avatarUrl,
      },
    ]);
  });

  it('offers a global Cursor agent before Cursor is connected', () => {
    const cursorAgent = agent('cursor-agent', 'Cursor agent', 'all', 'cursor');

    expect(availableBotMentionUsers([], [cursorAgent])).toHaveLength(1);
  });
});
