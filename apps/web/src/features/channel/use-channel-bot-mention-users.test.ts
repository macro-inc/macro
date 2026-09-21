import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import type { Agent } from '@service-storage/generated/schemas/agent';
import type { Bot } from '@service-storage/generated/schemas/bot';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  availableBotMentionUsers,
  useMessageBotMentionUsers,
} from './use-channel-bot-mention-users';

const flags = vi.hoisted(() => ({ cursor: (): boolean => false }));
vi.mock('@core/constant/featureFlags', () => ({
  enableCursorAgents: { key: 'enable-cursor-agents' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: flags.cursor() }),
}));

vi.mock('@queries/channel/channel-bots', () => ({
  useChannelBotsQuery: () => ({ isSuccess: true, data: [] }),
}));
vi.mock('@queries/agents/agents', () => ({
  useAgentsQuery: () => ({
    isSuccess: true,
    data: [
      agent('codex-agent', 'Codex', 'all', 'codex-cloud'),
      agent(CURSOR_BOT_ID, 'Cursor', 'all', 'cursor'),
    ],
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
    flags.cursor = () => false;
  });

  it('updates Cursor mention visibility when the rollout changes', () => {
    createRoot((dispose) => {
      const [enabled, setEnabled] = createSignal(false);
      flags.cursor = enabled;
      const users = useMessageBotMentionUsers(() => ({
        type: 'channel' as const,
        id: 'channel-1',
      }));
      expect(users().map((user) => user.id)).toEqual(['bot|codex-agent']);
      setEnabled(true);
      expect(users().map((user) => user.id)).toEqual([
        'bot|codex-agent',
        `bot|${CURSOR_BOT_ID}`,
      ]);
      setEnabled(false);
      expect(users().map((user) => user.id)).toEqual(['bot|codex-agent']);
      dispose();
    });
  });

  it('gates built-in Cursor while preserving custom agents regardless of harness', () => {
    const global = agent('global-cursor', 'Global Cursor', 'all', 'cursor');
    const installed = agent(
      'installed-cursor',
      'Installed Cursor',
      'selected',
      'cursor'
    );
    const codex = agent('codex', 'Codex', 'all', 'codex-cloud');
    const claude = agent('claude', 'Claude', 'all', 'claude-cloud');
    expect(
      availableBotMentionUsers(
        [bot(CURSOR_BOT_ID, 'Cursor'), installed.bot],
        [global, installed, codex, claude],
        false
      ).map((user) => user.id)
    ).toEqual([
      'bot|installed-cursor',
      'bot|global-cursor',
      'bot|codex',
      'bot|claude',
    ]);
  });
  it('hides the built-in Cursor bot before agent metadata is available', () => {
    expect(
      availableBotMentionUsers(
        [bot(CURSOR_BOT_ID, 'Cursor'), bot('custom', 'Custom agent')],
        [],
        false
      ).map((user) => user.id)
    ).toEqual(['bot|custom']);
  });
  it('offers Codex from the mention query without requiring account setup', () => {
    createRoot((dispose) => {
      expect(
        useMessageBotMentionUsers(() => ({
          type: 'channel' as const,
          id: 'channel-1',
        }))().map((user) => user.id)
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
        availableBotMentionUsers(
          [installed.bot],
          [global, installed],
          true
        ).map((user) => user.id)
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
        ],
        true
      ).map((user) => user.id)
    ).toEqual(['bot|installed', 'bot|global']);
  });

  it('deduplicates an agent that is also an installed channel bot', () => {
    expect(
      availableBotMentionUsers(
        [bot('global', 'Global')],
        [agent('global', 'Global', 'all')],
        true
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
        true
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

    expect(availableBotMentionUsers([], [cursorAgent], true)).toHaveLength(1);
  });

  it('includes channel-selected agents on a document surface only', () => {
    const selected = agent('doc-only', 'Doc only', 'selected');
    expect(
      availableBotMentionUsers([], [selected], true, 'channel').map((u) => u.id)
    ).toEqual([]);
    expect(
      availableBotMentionUsers([], [selected], true, 'document').map(
        (u) => u.id
      )
    ).toEqual(['bot|doc-only']);
  });
});
