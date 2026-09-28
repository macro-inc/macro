import type { ChannelTargetRequest } from '@channel/Channel/ChannelSurface';
import type { ChannelEntity } from '@entity/types/entity';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getTarget:
    vi.fn<
      typeof import('@app/features/next-soup/utils').getChannelEntityTarget
    >(),
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
  ChannelDetail: (props: { target?: ChannelTargetRequest }) => (
    <output data-testid="target">{JSON.stringify(props.target)}</output>
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
  mocks.getTarget.mockReturnValue(replyTarget);
});
afterEach(cleanup);

describe('Chat detail navigation', () => {
  it('requests a channel-wide target for unstamped route and favorite selections', () => {
    render(() => <ChannelDetailView channel={channel} />);

    expect(mocks.getTarget).toHaveBeenCalledExactlyOnceWith(channel, {
      scopeChannelThreads: false,
    });
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
      expect.objectContaining({ target: explicit }),
      { scopeChannelThreads: false }
    );
    expect(screen.getByTestId('target').textContent).toBe(
      JSON.stringify(target)
    );
  });
});
