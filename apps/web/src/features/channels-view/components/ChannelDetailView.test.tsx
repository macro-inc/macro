import type { ChannelTargetRequest } from '@channel/Channel/ChannelSurface';
import type { ChannelEntity } from '@entity/types/entity';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  routeSearch: vi.fn((): { seek?: string } => ({})),
  getTarget:
    vi.fn<
      typeof import('@app/features/next-soup/utils').getChannelEntityTarget
    >(),
}));
vi.mock('@app/lib/split-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/split-router')>()),
  createSearchParams: () => [mocks.routeSearch()],
}));
vi.mock('@app/features/next-soup/actions', () => ({
  useBlockEntityCommands: vi.fn(),
}));
vi.mock('@app/features/next-soup/utils', () => ({
  getChannelEntityTarget: mocks.getTarget,
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
  mocks.getTarget.mockReturnValue(replyTarget);
});
afterEach(cleanup);

describe('Chat detail navigation', () => {
  it('requests a thread-scoped target for unstamped route and favorite selections', () => {
    render(() => <ChannelDetailView channel={channel} />);

    expect(mocks.getTarget).toHaveBeenCalledExactlyOnceWith(channel);
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });

  it('keeps the initial target when notification reads replace the channel', () => {
    const [selected, setSelected] = createSignal(channel);
    render(() => <ChannelDetailView channel={selected()} />);

    mocks.getTarget.mockReturnValue({ kind: 'latest' });
    setSelected({ ...channel, notifications: () => [] });

    expect(mocks.getTarget).toHaveBeenCalledOnce();
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
  });

  it('resolves a new explicit target rather than retaining the initial unread target', () => {
    const [selected, setSelected] = createSignal(channel);
    render(() => <ChannelDetailView channel={selected()} />);
    const explicit = { messageId: 'search-hit', threadId: 'search-thread' };
    const target = { kind: 'message' as const, ...explicit };
    mocks.getTarget.mockReturnValue(target);

    setSelected({ ...channel, target: explicit });

    expect(mocks.getTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({ target: explicit })
    );
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(target)
    );
  });

  it('replays the same search target without re-deriving it from notifications', () => {
    const [seek, setSeek] = createSignal('first');
    mocks.routeSearch.mockReturnValue({
      get seek() {
        return seek();
      },
    });
    render(() => <ChannelDetailView channel={channel} />);
    expect(screen.getByTestId('target').dataset.request).toBe('first');

    mocks.getTarget.mockReturnValue({ kind: 'latest' });
    setSeek('repeat');

    expect(screen.getByTestId('target').dataset.request).toBe('repeat');
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(replyTarget)
    );
    expect(mocks.getTarget).toHaveBeenCalledOnce();
  });
});
