import { ok } from 'neverthrow';
import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  type RecipientOption,
  type ShareItem,
  type ShareLocation,
  toShareItem,
  useShareForm,
} from './share-delivery';

const mocks = vi.hoisted(() => ({
  resolvePeopleChannel: vi.fn(),
  sendToChannel: vi.fn(),
  changeChannelAccess: vi.fn(),
  track: vi.fn(),
  minted: 0,
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: mocks.track }),
}));
vi.mock('@core/constant/allBlocks', () => ({
  resolveBlockAlias: (name: string) =>
    ['task', 'snippet', 'skill'].includes(name) ? 'md' : name,
}));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_MARKDOWN_COMMENTS: false,
}));
vi.mock('@core/util/channels', () => ({
  useSendMessageToPeople: () => ({
    resolvePeopleChannel: mocks.resolvePeopleChannel,
    sendToChannel: mocks.sendToChannel,
  }),
}));
vi.mock('@queries/messages/mutations', () => ({
  newMessageId: () => `message-${++mocks.minted}`,
}));
vi.mock('./queries/channel-access', () => ({
  changeChannelAccess: mocks.changeChannelAccess,
}));

const user = (id: string): RecipientOption => ({
  kind: 'user',
  id,
  data: { id, email: `${id}@example.com`, name: id },
});

const channel = (id: string): RecipientOption => ({
  kind: 'channel',
  id,
  data: {
    id,
    channel_type: 'public',
    owner_id: 'owner-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    auto_join_team: false,
    participants: [],
    is_participant: true,
  },
});

const plan = toShareItem({
  id: 'doc-1',
  kind: 'document',
  name: 'Plan',
  block: 'md',
  canGrant: true,
});

function mountForm(items: readonly ShareItem[], location: ShareLocation) {
  return createRoot((dispose) => {
    onTestFinished(dispose);
    return useShareForm(() => items, { location });
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.minted = 0;
  mocks.changeChannelAccess.mockResolvedValue(ok(undefined));
});

describe('toShareItem', () => {
  it.each([
    { block: 'md', markdown: true },
    { block: 'task', markdown: true },
    { block: 'agent', markdown: false },
    { block: undefined, markdown: false },
  ] as const)(
    'reads block $block as markdown: $markdown',
    ({ block, markdown }) => {
      const item = toShareItem({
        id: 'doc-1',
        kind: 'document',
        name: 'Plan',
        block,
        canGrant: true,
      });

      expect(item.markdown).toBe(markdown);
    }
  );

  it('keeps only channel levels from existing grants', () => {
    const item = toShareItem({
      id: 'doc-1',
      kind: 'document',
      name: 'Plan',
      canGrant: false,
      channelGrants: [
        { channel_id: 'channel-1', access_level: 'edit' },
        { channel_id: 'channel-2', access_level: 'owner' },
        { channel_id: 'channel-3', access_level: 'comment' },
      ],
    });

    expect(item).toEqual({
      kind: 'document',
      id: 'doc-1',
      name: 'Plan',
      markdown: false,
      canGrant: false,
      channelGrants: new Map([
        ['channel-1', 'edit'],
        ['channel-3', 'comment'],
      ]),
    });
  });

  it('reads grants the server left null as none', () => {
    const item = toShareItem({
      id: 'doc-1',
      kind: 'document',
      name: 'Plan',
      canGrant: true,
      channelGrants: null,
    });

    expect(item.channelGrants).toEqual(new Map());
  });
});

describe('useShareForm', () => {
  it('posts each item as its reference attachment under a minted id', async () => {
    const navigate = vi.fn();
    mocks.sendToChannel.mockResolvedValue({
      channelId: 'channel-1',
      navigateToChannel: navigate,
    });
    const form = mountForm(
      [
        toShareItem({
          id: 'thread-1',
          kind: 'email',
          name: 'Invoice',
          canGrant: true,
        }),
        toShareItem({
          id: 'session-1',
          kind: 'agent_session',
          name: 'Fix the menu',
          canGrant: true,
        }),
      ],
      'bulk_share'
    );
    form.setRecipients([channel('channel-1')]);
    form.setText('FYI');

    const result = await form.submit();

    expect(mocks.sendToChannel.mock.calls).toEqual([
      [
        {
          channelId: 'channel-1',
          content: 'FYI',
          mentions: [],
          attachments: [
            { entity_type: 'thread', entity_id: 'thread-1' },
            { entity_type: 'agent_session', entity_id: 'session-1' },
          ],
          messageId: 'message-1',
        },
      ],
    ]);
    expect(result?.open).toBe(navigate);
  });

  it('sends a group to its private channel and retries under the same id', async () => {
    mocks.resolvePeopleChannel.mockResolvedValue('group-1');
    mocks.sendToChannel.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      channelId: 'group-1',
      navigateToChannel: vi.fn(),
    });
    const form = mountForm([plan], 'forward_to_channel');
    form.setRecipients([user('user-1'), user('user-2')]);

    await form.submit();
    await form.submit();

    expect(mocks.resolvePeopleChannel.mock.calls).toEqual([
      [['user-1', 'user-2']],
    ]);
    expect(
      mocks.sendToChannel.mock.calls.map(([message]) => [
        message.channelId,
        message.messageId,
      ])
    ).toEqual([
      ['group-1', 'message-1'],
      ['group-1', 'message-1'],
    ]);
  });

  it('grants through the kind registry and tracks the forward', async () => {
    mocks.sendToChannel.mockResolvedValue({
      channelId: 'channel-1',
      navigateToChannel: vi.fn(),
    });
    const form = mountForm([plan], 'forward_to_channel');
    form.setRecipients([channel('channel-1')]);

    await form.submit();

    expect(mocks.changeChannelAccess.mock.calls).toEqual([
      [plan, { t: 'set', channelId: 'channel-1', level: 'edit' }],
    ]);
    expect(mocks.track.mock.calls).toEqual([
      [
        'share_entity',
        {
          entityType: 'document',
          entityId: 'doc-1',
          shareMethod: 'channel',
          accessLevel: 'edit',
          location: 'forward_to_channel',
        },
      ],
      [
        'share_entity',
        {
          entityType: 'document',
          entityId: 'doc-1',
          shareMethod: 'forward',
          targetType: 'channel',
          location: 'forward_to_channel',
        },
      ],
    ]);
  });

  it('counts the batch on every bulk share event', async () => {
    mocks.resolvePeopleChannel.mockResolvedValue('dm-1');
    mocks.sendToChannel.mockResolvedValue({
      channelId: 'dm-1',
      navigateToChannel: vi.fn(),
    });
    const form = mountForm(
      [
        toShareItem({
          id: 'thread-1',
          kind: 'email',
          name: 'Invoice',
          canGrant: false,
        }),
        toShareItem({
          id: 'call-1',
          kind: 'call',
          name: 'Standup',
          canGrant: true,
        }),
      ],
      'bulk_share'
    );
    form.setRecipients([user('user-1')]);

    await form.submit();

    expect(mocks.track.mock.calls).toEqual([
      [
        'share_entity',
        {
          entityType: 'email',
          entityId: 'thread-1',
          shareMethod: 'forward',
          targetType: 'user',
          location: 'bulk_share',
          bulkCount: 2,
        },
      ],
      [
        'share_entity',
        {
          entityType: 'call',
          entityId: 'call-1',
          shareMethod: 'forward',
          targetType: 'user',
          location: 'bulk_share',
          bulkCount: 2,
        },
      ],
    ]);
  });

  it('offers no comment level for markdown while markdown comments are off', () => {
    const form = mountForm([plan], 'forward_to_channel');

    expect(form.level()).toEqual({ options: ['view', 'edit'], value: 'edit' });
  });
});
