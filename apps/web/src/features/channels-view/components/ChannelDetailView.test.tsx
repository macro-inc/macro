import type { ChannelTargetRequest } from '@channel/Channel/ChannelSurface';
import type { ChannelEntity } from '@entity/types/entity';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeSearch: vi.fn((): { seek?: string } => ({})),
}));
vi.mock('@app/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/split-router')>()),
  createSearchParams: () => [mocks.routeSearch()],
}));
vi.mock('@app/features/next-soup/actions', () => ({
  useBlockEntityCommands: vi.fn(),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: 'test' }),
}));
vi.mock('@channel/Channel/ChannelDetail', () => ({
  ChannelDetail: (props: {
    target?: ChannelTargetRequest;
    navigationRequest?: string;
  }) => (
    <output data-testid="target" data-request={props.navigationRequest}>
      {JSON.stringify(props.target)}
    </output>
  ),
  ChannelDetailTopBar: () => null,
}));
vi.mock('./ChannelTitleMenu', () => ({ ChannelTitleMenu: () => null }));

import { ChannelDetailView } from './ChannelDetailView';

const channel: ChannelEntity = {
  id: 'channel',
  type: 'channel',
  name: 'Channel',
  ownerId: 'owner',
  channelType: 'private',
};
const replyTarget = {
  kind: 'message' as const,
  messageId: 'reply',
  threadId: 'root',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routeSearch.mockReturnValue({});
});
afterEach(cleanup);

describe('Chat detail navigation', () => {
  it('passes an explicit destination to the channel surface', () => {
    render(() => <ChannelDetailView channel={channel} target={replyTarget} />);
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });

  it('accepts the initial unread destination after the channel has mounted', () => {
    const [target, setTarget] = createSignal<ChannelTargetRequest>();
    render(() => <ChannelDetailView channel={channel} target={target()} />);
    expect(screen.getByTestId('target').textContent).toBe('');
    setTarget(replyTarget);
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });

  it('does not derive navigation from notification changes', () => {
    const [selected, setSelected] = createSignal(channel);
    render(() => (
      <ChannelDetailView channel={selected()} target={replyTarget} />
    ));
    setSelected({ ...channel, notifications: () => [] });
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });

  it('replays the same search target without re-deriving it from notifications', () => {
    const [seek, setSeek] = createSignal('first');
    mocks.routeSearch.mockReturnValue({
      get seek() {
        return seek();
      },
    });
    render(() => <ChannelDetailView channel={channel} target={replyTarget} />);
    expect(screen.getByTestId('target').dataset.request).toBe('first');

    setSeek('repeat');

    expect(screen.getByTestId('target').dataset.request).toBe('repeat');
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });
});
