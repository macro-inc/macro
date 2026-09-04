import type { Agent } from '@service-storage/generated/schemas/agent';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { describe, expect, it } from 'vitest';
import { availableBotMentionUsers } from './use-channel-bot-mention-users';

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
  it('adds all-channel agents without adding selected agents from other channels', () => {
    expect(
      availableBotMentionUsers(
        [bot('installed', 'Installed')],
        [
          agent('global', 'Global', 'all'),
          agent('selected', 'Selected', 'selected'),
        ],
        false
      ).map((user) => user.id)
    ).toEqual(['bot|installed', 'bot|global']);
  });

  it('deduplicates an agent that is also an installed channel bot', () => {
    expect(
      availableBotMentionUsers(
        [bot('global', 'Global')],
        [agent('global', 'Global', 'all')],
        false
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
        ],
        false
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

  it('only offers a global Cursor agent when Cursor is connected', () => {
    const cursorAgent = agent('cursor-agent', 'Cursor agent', 'all', 'cursor');

    expect(availableBotMentionUsers([], [cursorAgent], false)).toEqual([]);
    expect(availableBotMentionUsers([], [cursorAgent], true)).toHaveLength(1);
  });
});
