/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@solidjs/testing-library';
import { onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  channels: vi.fn(),
  activity: vi.fn(() => ({ isPending: false, isLoading: false, data: [] })),
}));
vi.mock('@queries/channel/channels', () => ({
  useListChannelsQuery: mocks.channels,
}));
vi.mock('@queries/channel/activity', () => ({
  useChannelsActivityQuery: mocks.activity,
}));
vi.mock('./user', () => ({
  useUserId: () => () => undefined,
  useIsAuthenticated: () => () => true,
}));

import {
  ChannelsContextProvider,
  useChannelCanCall,
  useChannelsContext,
} from './channels';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function CanCall(props: { channelId: string }) {
  const canCall = useChannelCanCall(props.channelId);
  return <output>{String(canCall())}</output>;
}

function setup(channelId: string) {
  const [list, setList] = createStore({
    loading: true,
    channels: [] as { id: string; agent_dm?: { bot_id: string } }[],
  });
  mocks.channels.mockReturnValue({
    get isPending() {
      return list.loading;
    },
    get isLoading() {
      return list.loading;
    },
    get data() {
      if (list.loading) throw new Error('Pending data must not be read');
      return list.channels;
    },
  });
  const view = render(() => (
    <ChannelsContextProvider>
      <CanCall channelId={channelId} />
    </ChannelsContextProvider>
  ));
  return { setList, value: () => view.getByRole('status').textContent };
}

describe('useChannelCanCall', () => {
  it('waits for the channel list, then refuses an agent DM', () => {
    const { setList, value } = setup('dm');
    expect(value()).toBe('undefined');
    setList({
      loading: false,
      channels: [{ id: 'dm', agent_dm: { bot_id: 'bot' } }],
    });
    expect(value()).toBe('false');
  });

  it('allows a listed channel that is not an agent DM', () => {
    const { setList, value } = setup('team');
    setList({ loading: false, channels: [{ id: 'team' }] });
    expect(value()).toBe('true');
  });

  it('allows a channel the loaded list does not have', () => {
    const { setList, value } = setup('public');
    setList({ loading: false, channels: [{ id: 'other' }] });
    expect(value()).toBe('true');
  });
});

it('initializes channel and activity observers independently on first data demand', () => {
  let channels: () => unknown = () => undefined;
  let activity: () => unknown = () => undefined;
  const disposed = vi.fn();
  mocks.channels.mockImplementation(() => {
    onCleanup(disposed);
    return { isPending: false, isLoading: false, data: [] };
  });
  function Capture() {
    const context = useChannelsContext();
    channels = context.channels;
    activity = context.activity;
    return null;
  }
  const view = render(() => (
    <ChannelsContextProvider>
      <Capture />
    </ChannelsContextProvider>
  ));
  expect(mocks.channels).not.toHaveBeenCalled();
  expect(mocks.activity).not.toHaveBeenCalled();
  expect(channels()).toEqual([]);
  expect(channels()).toEqual([]);
  expect(mocks.channels).toHaveBeenCalledOnce();
  expect(mocks.activity).not.toHaveBeenCalled();
  expect(disposed).not.toHaveBeenCalled();
  expect(activity()).toEqual([]);
  expect(mocks.activity).toHaveBeenCalledOnce();
  view.unmount();
  expect(disposed).toHaveBeenCalledOnce();
});
