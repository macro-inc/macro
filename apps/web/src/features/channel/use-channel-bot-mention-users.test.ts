import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import type { BotIdentity } from '@queries/bots/graphql-bots';
import type { MessageParent } from '@service-storage/messages';
import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  botMentionUsers,
  useMessageBotMentionUsers,
} from './use-channel-bot-mention-users';

const flags = vi.hoisted(() => ({ cursor: (): boolean => false }));
const offline = vi.hoisted(() => ({ ids: new Set<string>() }));
const mentionable = vi.hoisted(() => ({
  bots: [] as BotIdentity[],
  scopes: [] as (string | null | undefined)[],
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCursorAgents: { key: 'enable-cursor-agents' },
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: flags.cursor() }),
}));
vi.mock('@queries/bots/graphql-bots', () => ({
  createMentionableBots: (scope: () => string | null | undefined) => ({
    bots: () => {
      mentionable.scopes.push(scope());
      return scope() === undefined ? [] : mentionable.bots;
    },
  }),
}));
vi.mock('@queries/agents/offline-runtimes', () => ({
  useOfflineAgentBotIds: () => () => offline.ids,
}));

function bot(id: string, name: string, avatarUrl?: string): BotIdentity {
  return {
    id,
    name,
    handle: name.toLowerCase().replaceAll(' ', '-'),
    avatarUrl,
    deleted: false,
    isSystem: false,
  };
}

function mentionIds(parent: MessageParent, load?: () => boolean) {
  return createRoot((dispose) => {
    const ids = useMessageBotMentionUsers(() => parent, load)().map(
      (user) => user.id
    );
    dispose();
    return ids;
  });
}

beforeEach(() => {
  flags.cursor = () => false;
  offline.ids = new Set<string>();
  mentionable.bots = [
    bot('codex-agent', 'Codex'),
    bot(CURSOR_BOT_ID, 'Cursor'),
  ];
  mentionable.scopes = [];
});

describe('useMessageBotMentionUsers', () => {
  it('asks for a channel’s bots in a channel and every agent elsewhere', () => {
    mentionIds({ type: 'channel', id: 'channel-1' });
    mentionIds({ type: 'document', id: 'doc-1' });
    mentionIds({ type: 'call', id: 'call-1' });
    expect(mentionable.scopes).toEqual(['channel-1', null, null]);
  });

  it('reads nothing off a channel until the composer loads', () => {
    expect(mentionIds({ type: 'document', id: 'doc-1' }, () => false)).toEqual(
      []
    );
    expect(mentionable.scopes).toEqual([undefined]);
    expect(
      mentionIds({ type: 'channel', id: 'channel-1' }, () => false)
    ).toEqual(['bot|codex-agent']);
  });

  it('marks an agent whose runtime is offline', () => {
    flags.cursor = () => true;
    offline.ids = new Set(['codex-agent']);
    createRoot((dispose) => {
      const users = useMessageBotMentionUsers(() => ({
        type: 'channel',
        id: 'channel-1',
      }));
      expect(
        users().find((user) => user.id === 'bot|codex-agent')?.offline
      ).toBe(true);
      expect(
        users().find((user) => user.id === `bot|${CURSOR_BOT_ID}`)?.offline
      ).toBeUndefined();
      dispose();
    });
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
});

describe('botMentionUsers', () => {
  it('hides only the built-in Cursor bot while Cursor is off', () => {
    expect(
      botMentionUsers(
        [bot(CURSOR_BOT_ID, 'Cursor'), bot('custom-cursor', 'Custom Cursor')],
        false
      ).map((user) => user.id)
    ).toEqual(['bot|custom-cursor']);
  });

  it('names a mention after the bot and keeps its picture', () => {
    const avatarUrl = 'https://example.com/global-agent.png';
    expect(botMentionUsers([bot('global', 'Global', avatarUrl)], true)).toEqual(
      [
        {
          id: 'bot|global',
          name: 'Global',
          email: 'Global',
          photoUrl: avatarUrl,
        },
      ]
    );
  });
});
