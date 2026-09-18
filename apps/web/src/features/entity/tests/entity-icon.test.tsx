import CalendarIcon from '@phosphor/calendar.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import EnvelopeOpenIcon from '@phosphor/envelope-open.svg';
import FileIcon from '@phosphor/file-dashed.svg';
import GitMergeIcon from '@phosphor/git-merge.svg';
import GitPullRequestIcon from '@phosphor/git-pull-request.svg';
import DirectMessageIcon from '@phosphor/users.svg';
import GitMergeBold from '@phosphor-icons/core/bold/git-merge-bold.svg';
import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeEntityIcon } from '../../inbox-view/components/HomeEntityIcon';
import { EntityIcon } from '../extractors/entity-icon';
import type {
  ChannelEntity,
  ChannelMessageEntity,
  EmailEntity,
  GithubPullRequestEntity,
  UnknownForeignEntity,
} from '../types/entity';

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
  status: GithubPullRequestEntity['metadata']['status']
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
      additions: 1,
      deletions: 1,
      comments: [],
      checks: [],
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
    [true, false, EnvelopeOpenIcon, 'text-default'],
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
