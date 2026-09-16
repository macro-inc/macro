const codexAccess = vi.hoisted(() => ({ enabled: true }));
vi.mock('@core/codex/flag', () => ({
  useCodexAgentsAccess: () => () => codexAccess.enabled,
}));

import type { Agent } from '@service-storage/generated/schemas/agent';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  availableBotMentionUsers,
  useChannelBotMentionUsers,
} from './use-channel-bot-mention-users';

const readiness = vi.hoisted(() => ({
  connected: true,
  environmentId: null as string | null,
}));
vi.mock('@queries/auth/codex', () => ({
  useCodexStatusQuery: () => ({ isSuccess: true, data: readiness }),
}));
vi.mock('@queries/auth/cursor-api-key', () => ({
  useCursorApiKeyStatusQuery: () => ({
    isSuccess: true,
    data: { registered: false },
  }),
}));
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
  beforeEach(() => {
    codexAccess.enabled = true;
  });
  it('hides connected Codex agents when the rollout is disabled', () => {
    codexAccess.enabled = false;
    readiness.environmentId = 'env-saved';
    createRoot((dispose) => {
      expect(useChannelBotMentionUsers(() => 'channel-1')()).toEqual([]);
      dispose();
    });
  });
  it.each([null, '', '   ', 'env-saved'])(
    'gates the real mention query on saved environment %s',
    (environmentId) => {
      readiness.environmentId = environmentId;
      createRoot((dispose) => {
        const users = useChannelBotMentionUsers(() => 'channel-1');
        expect(users().map((user) => user.id)).toEqual(
          environmentId === 'env-saved' ? ['bot|codex-agent'] : []
        );
        dispose();
      });
    }
  );
  it('hides installed Codex personas when access is disabled', () => {
    const codex = agent('codex-agent', 'Codex', 'selected', 'codex-cloud');
    expect(
      availableBotMentionUsers(
        [codex.bot, bot('other', 'Other')],
        [codex],
        false,
        false
      ).map((user) => user.id)
    ).toEqual(['bot|other']);
    expect(
      availableBotMentionUsers([codex.bot], [codex], false, true)
    ).toHaveLength(1);
  });
  it('only offers Codex agents after connection and environment readiness', () => {
    const codex = agent('codex-agent', 'Codex', 'all', 'codex-cloud');
    expect(availableBotMentionUsers([], [codex], false, false)).toEqual([]);
    expect(availableBotMentionUsers([], [codex], false, true)).toHaveLength(1);
  });
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
