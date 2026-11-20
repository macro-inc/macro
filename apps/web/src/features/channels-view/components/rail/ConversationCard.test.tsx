import type { ChannelEntity } from '@entity';
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ConversationCard } from './ChannelRailItems';

vi.mock('@core/context/user', () => ({ useUserId: () => () => 'viewer' }));
vi.mock('@entity', () => ({
  Entity: { Icon: () => <span />, Timestamp: () => <span>now</span> },
}));
vi.mock('@app/features/soup/SoupEntityContextMenu', () => ({
  SoupEntityContextMenu: () => null,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: { markdown: string }) => (
      <span>{props.markdown}</span>
    ),
  })
);
vi.mock('../../../channel/Call/components/CallWaveform', () => ({
  CallWaveform: () => null,
}));

const channel = {
  id: 'channel-1',
  type: 'channel',
  name: 'launch-plan',
  channelType: 'team',
  latestRootMessage: undefined,
} as unknown as ChannelEntity;

function renderCard(props: { unread: boolean; mentions?: number }) {
  render(() => (
    <ConversationCard
      id="recent-card"
      channel={channel}
      mentionedCurrentUser={false}
      unread={props.unread}
      mentions={props.mentions}
      muted={false}
      selected={false}
      focused={false}
      onActivate={() => {}}
    />
  ));
}

describe('Recents conversation card', () => {
  it('shows the mention count in place of the unread dot', () => {
    renderCard({ unread: true, mentions: 2 });

    expect(
      screen.getByRole('img', { name: '2 unread mentions' }).textContent
    ).toBe('2');
    expect(screen.queryByLabelText('Unread')).toBeNull();
  });

  it('keeps the unread dot when nothing mentions the viewer', () => {
    renderCard({ unread: true });

    expect(screen.getByLabelText('Unread')).toBeTruthy();
    expect(screen.queryByRole('img', { name: /mention/ })).toBeNull();
  });
});
