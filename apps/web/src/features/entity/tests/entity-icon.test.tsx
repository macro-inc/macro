import { FavoriteIcon } from '@app/features/favorites/FavoriteIcon';
import { ChannelTopIcon } from '@channel/components/ChannelTopIcon';
import GitMergeBold from '@icon/system/bold/git-merge-bold.svg';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import EnvelopeIcon from '@icon/system/regular/envelope.svg';
import EnvelopeOpenIcon from '@icon/system/regular/envelope-open.svg';
import FileIcon from '@icon/system/regular/file-dashed.svg';
import GitMergeIcon from '@icon/system/regular/git-merge.svg';
import GitPullRequestIcon from '@icon/system/regular/git-pull-request.svg';
import DirectMessageIcon from '@icon/system/regular/users.svg';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEntityIcon } from '../../home/components/HomeEntityIcon';
import { EntityIcon } from '../extractors/entity-icon';
import type {
  ChannelEntity,
  ChannelMessageEntity,
  EmailEntity,
  GithubPullRequestEntity,
  UnknownForeignEntity,
} from '../types/entity';

type CachedIconChannel = {
  channel_type: 'direct_message';
  name: string;
  participants: { user_id: string }[];
  agent_dm?: { bot_id: string; name: string; avatar_url?: string | null };
};

const channelCache = vi.hoisted(() => ({
  read: (): Record<string, CachedIconChannel> => ({}),
}));
vi.mock('@queries/channel/channel-participants', () => ({
  useChannelParticipantsQuery: vi.fn(),
}));
vi.mock('@app/util/favorites', () => ({
  favoriteIconType: () => 'channel',
}));

const channelPicture = vi.hoisted(() => ({
  url: undefined as string | undefined,
  channelIds: [] as string[],
}));
vi.mock('@queries/channel/picture', () => ({
  useChannelPicture: (channelId: () => string) => {
    channelPicture.channelIds.push(channelId());
    return { url: () => channelPicture.url, revision: () => 1 };
  },
}));
vi.mock('@core/constant/allBlocks', () => ({
  blockAcceptedFileExtensionSet: new Set(),
  fileTypeToBlockName: vi.fn(),
  isBlockAlias: () => false,
  itemToBlockName: vi.fn(),
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channelsById: () => channelCache.read() }),
  useChannelType: (id: string) => () => channelCache.read()[id]?.channel_type,
}));
vi.mock('@app/features/agent-dms/components/persona-avatar', () => ({
  PersonaAvatar: (props: { botId: string; name: string }) => (
    <span data-testid="agent-avatar" data-bot-id={props.botId}>
      {props.name}
    </span>
  ),
}));
vi.mock('@core/component/UserIcon', () => ({
  UserIcon: (props: { id: string }) => (
    <span data-testid="user-avatar" data-user-id={props.id} />
  ),
}));
vi.mock('../components/ChatProviderIcon', () => ({
  ChatProviderIcon: () => null,
}));
vi.mock('@ui', async () => ({
  cn: (await import('@ui/utils/classname')).cn,
}));

const foreignBase = {
  type: 'foreign',
  id: 'foreign-id',
  name: 'Foreign entity',
  ownerId: 'user',
  foreignId: 'external-id',
  storedForId: 'team-id',
  storedForAuthEntity: 'team',
} as const;

function pullRequest(
  status: GithubPullRequestEntity['metadata']['status'],
  draft = false
): GithubPullRequestEntity {
  return {
    ...foreignBase,
    foreignSource: 'github_pull_request',
    metadata: {
      number: 42,
      name: 'Update icons',
      owner: 'macro-inc',
      repo: 'macro',
      url: 'https://github.com/macro-inc/macro/pull/42',
      status,
      draft,
      additions: 1,
      deletions: 1,
      comments: [],
      checks: [],
      labels: [],
    },
  };
}

function expectGlyph(container: HTMLElement, Glyph: typeof FileIcon) {
  const expected = render(() => <Glyph />);
  const svg = container.querySelector('svg');
  expect(svg).not.toBeNull();
  expect(svg?.innerHTML).toBe(
    expected.container.querySelector('svg')?.innerHTML
  );
}

afterEach(cleanup);

describe('Entity.Icon', () => {
  beforeEach(() => {
    channelPicture.url = undefined;
    channelPicture.channelIds = [];
    channelCache.read = () => ({});
  });

  const channel: ChannelEntity = {
    type: 'channel',
    id: 'channel-id',
    name: 'Channel',
    ownerId: 'user',
    channelType: 'private',
  };

  it('renders a channel picture when available', () => {
    channelPicture.url = 'https://example.com/channel.png';
    const { container } = render(() => <EntityIcon entity={channel} />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe(
      channelPicture.url
    );
    expect(channelPicture.channelIds).toEqual(['channel-id']);
  });

  it('renders a channel glyph when there is no picture', () => {
    const { container } = render(() => <EntityIcon entity={channel} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('loads the parent channel picture for a channel message', () => {
    const message: ChannelMessageEntity = {
      ...channel,
      type: 'channel_message',
      id: 'message-id',
      channelId: channel.id,
      channelName: channel.name,
      messageId: 'message-id',
      senderId: 'user',
      content: 'Message',
    };
    render(() => <EntityIcon entity={message} />);
    expect(channelPicture.channelIds).toEqual(['channel-id']);
  });

  it('keeps direct messages on their participant avatar', () => {
    const { container } = render(() => (
      <EntityIcon
        entity={{
          ...channel,
          channelType: 'direct_message',
          participantIds: ['user', 'other-user'],
        }}
      />
    ));
    expect(channelPicture.channelIds).toEqual([]);
    expect(
      container
        .querySelector('[data-testid="user-avatar"]')
        ?.getAttribute('data-user-id')
    ).toBe('other-user');
  });

  it('gives persona DMs an agent avatar without a person tooltip or profile action', () => {
    const { container } = render(() => (
      <EntityIcon
        entity={{
          ...channel,
          channelType: 'direct_message',
          name: 'Researcher',
          participantIds: ['user', 'bot|researcher'],
        }}
      />
    ));
    expect(container.querySelector('[data-testid="user-avatar"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="agent-avatar"]')?.textContent
    ).toBe('Researcher');
  });

  it('updates favorite, row, and header DM avatars when participant data arrives', () => {
    const [cached, setCached] = createSignal<Record<string, CachedIconChannel>>(
      {}
    );
    channelCache.read = cached;
    const { container } = render(() => (
      <>
        <FavoriteIcon
          favorite={{
            entityType: 'channel',
            entityId: 'dm',
            channelType: 'direct_message',
            sortOrder: 0,
            createdAt: '2026-01-01',
          }}
        />
        <EntityIcon
          entity={{ ...channel, id: 'dm', channelType: 'direct_message' }}
        />
        <ChannelTopIcon
          channelId="dm"
          channelType="direct_message"
          participants={(cached().dm?.participants ?? []).map(
            (participant) => ({
              ...participant,
              channel_id: 'dm',
              role: 'member' as const,
              joined_at: '2026-01-01',
            })
          )}
          suppressClick
        />
      </>
    ));
    expect(container.querySelector('[data-testid="user-avatar"]')).toBeNull();
    expect(channelPicture.channelIds).toEqual([]);

    setCached({
      dm: {
        channel_type: 'direct_message',
        name: 'Direct message',
        participants: [{ user_id: 'user' }, { user_id: 'other-user' }],
      },
    });
    expect(
      [...container.querySelectorAll('[data-testid="user-avatar"]')].map(
        (avatar) => avatar.getAttribute('data-user-id')
      )
    ).toEqual(['other-user', 'other-user', 'other-user']);

    setCached({
      dm: {
        channel_type: 'direct_message',
        name: 'Self DM',
        participants: [{ user_id: 'user' }],
      },
    });
    expect(
      [...container.querySelectorAll('[data-testid="user-avatar"]')].map(
        (avatar) => avatar.getAttribute('data-user-id')
      )
    ).toEqual(['user', 'user', 'user']);
  });

  it('uses the same persona for favorites, rows, and headers as cached identity changes', () => {
    const [cached, setCached] = createSignal<Record<string, CachedIconChannel>>(
      {
        dm: {
          channel_type: 'direct_message',
          name: 'Assistant',
          participants: [{ user_id: 'user' }, { user_id: 'bot|assistant' }],
        },
      }
    );
    channelCache.read = cached;
    const { container } = render(() => (
      <>
        <FavoriteIcon
          favorite={{
            entityType: 'channel',
            entityId: 'dm',
            channelType: 'direct_message',
            sortOrder: 0,
            createdAt: '2026-01-01',
          }}
        />
        <EntityIcon
          entity={{
            ...channel,
            id: 'dm',
            channelType: 'direct_message',
            name: 'Assistant',
          }}
        />
        <ChannelTopIcon
          channelId="dm"
          channelType="direct_message"
          participants={(cached().dm?.participants ?? []).map(
            (participant) => ({
              ...participant,
              channel_id: 'dm',
              role: 'member' as const,
              joined_at: '2026-01-01',
            })
          )}
          suppressClick
        />
      </>
    ));
    expect(container.querySelector('[data-testid="user-avatar"]')).toBeNull();
    expect(
      [...container.querySelectorAll('[data-testid="agent-avatar"]')].map(
        (avatar) => avatar.getAttribute('data-bot-id')
      )
    ).toEqual(['assistant', 'assistant', 'assistant']);

    setCached({
      dm: {
        channel_type: 'direct_message',
        name: 'Assistant',
        participants: [],
        agent_dm: { bot_id: 'researcher', name: 'Researcher' },
      },
    });
    expect(
      [...container.querySelectorAll('[data-testid="agent-avatar"]')].map(
        (avatar) => avatar.textContent
      )
    ).toEqual(['Researcher', 'Researcher', 'Researcher']);
    expect(channelPicture.channelIds).toEqual([]);
  });

  it.each(['user', 'other-user'])(
    'keeps DM message rows on their DM glyph without fetching channel pictures (sender %s)',
    (senderId) => {
      const message: ChannelMessageEntity = {
        type: 'channel_message',
        id: 'message-id',
        name: 'Message',
        ownerId: 'user',
        channelId: 'dm-channel',
        channelName: 'Direct message',
        channelType: 'direct_message',
        messageId: 'message-id',
        senderId,
        content: 'Message',
      };
      const { container } = render(() => <EntityIcon entity={message} />);
      expect(channelPicture.channelIds).toEqual([]);
      expectGlyph(container, DirectMessageIcon);
    }
  );

  it.each([
    [false, false, EnvelopeIcon, 'text-email'],
    [true, false, EnvelopeOpenIcon, 'text-ink-extra-muted'],
    [false, true, CalendarIcon, 'text-calendar'],
    [true, true, CalendarIcon, 'text-calendar'],
  ] as const)(
    'distinguishes read=%s and invite=%s emails',
    (isRead, hasIcsAttachment, Glyph, color) => {
      const entity: EmailEntity = {
        type: 'email',
        id: 'email-id',
        name: 'Email',
        ownerId: 'user',
        isRead,
        hasIcsAttachment,
        isDraft: false,
        isImportant: false,
        done: false,
      };
      const { container } = render(() => <EntityIcon entity={entity} />);
      expectGlyph(container, Glyph);
      expect(container.firstElementChild?.classList.contains(color)).toBe(true);
    }
  );

  it.each([
    ['open', GitPullRequestIcon, 'text-success'],
    ['merged', GitMergeIcon, 'text-note'],
    ['closed', GitPullRequestIcon, 'text-failure'],
  ] as const)('renders the %s pull request state', (status, Glyph, color) => {
    const { container } = render(() => (
      <EntityIcon entity={pullRequest(status)} />
    ));
    expectGlyph(container, Glyph);
    expect(container.firstElementChild?.classList.contains(color)).toBe(true);
  });

  it('renders draft pull request with muted color', () => {
    const { container } = render(() => (
      <EntityIcon entity={pullRequest('open', true)} />
    ));
    expectGlyph(container, GitPullRequestIcon);
    expect(
      container.firstElementChild?.classList.contains('text-ink-muted')
    ).toBe(true);
  });

  it('uses a generic file for unknown foreign sources even with PR-like metadata', () => {
    const entity: UnknownForeignEntity = {
      ...foreignBase,
      foreignSource: 'unknown',
      rawForeignSource: 'another-provider',
      metadata: { status: 'merged' },
    };
    const { container } = render(() => <EntityIcon entity={entity} />);
    expectGlyph(container, FileIcon);
    expect(
      container.firstElementChild?.classList.contains('text-default')
    ).toBe(true);
  });

  it('updates the pull request glyph and color when its status changes', () => {
    const [entity, setEntity] = createSignal(pullRequest('open'));
    const { container } = render(() => <EntityIcon entity={entity()} />);

    setEntity(pullRequest('merged'));

    expectGlyph(container, GitMergeIcon);
    expect(container.firstElementChild?.classList.contains('text-note')).toBe(
      true
    );
    expect(
      container.firstElementChild?.classList.contains('text-success')
    ).toBe(false);
  });

  it('forwards the requested weight for pull request states', () => {
    const { container } = render(() => (
      <EntityIcon entity={pullRequest('merged')} weight="bold" />
    ));
    expectGlyph(container, GitMergeBold);
    expect(container.firstElementChild?.classList.contains('text-note')).toBe(
      true
    );
  });

  it('preserves pull request status colors in compact Home rows', () => {
    const { container } = render(() => (
      <HomeEntityIcon entity={pullRequest('merged')} />
    ));
    expectGlyph(container, GitMergeIcon);
    const classes = container.querySelector('svg')?.parentElement?.classList;
    expect(classes?.contains('text-note')).toBe(true);
    expect(classes?.contains('text-current')).toBe(false);
  });
});
