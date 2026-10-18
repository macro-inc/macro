/**
 * @vitest-environment jsdom
 */

import { cleanup, render } from '@solidjs/testing-library';
import { createStore } from 'solid-js/store';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ channels: vi.fn(), native: vi.fn() }));
vi.mock('@queries/channel/channels', () => ({
  useListChannelsQuery: mocks.channels,
  useChannelMetadataQuery: mocks.native,
}));
vi.mock('@queries/channel/activity', () => ({
  useChannelsActivityQuery: () => ({
    isPending: false,
    isLoading: false,
    data: [],
  }),
}));
vi.mock('./user', () => ({ useUserId: () => () => undefined }));

import {
  ChannelsContextProvider,
  useChannelCanCall,
  useChannelMessagingBinding,
  useChannelName,
  useChannelType,
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

it('waits for authoritative native metadata for channels absent from the participant list', () => {
  const [native, setNative] = createStore<{
    isPending: boolean;
    data?: {
      messaging_binding: string;
      channel_name: string;
      channel_type: string;
    };
  }>({ isPending: true });
  mocks.native.mockReturnValue(native);
  mocks.channels.mockReturnValue({
    isPending: false,
    isLoading: false,
    data: [],
  });
  function Binding() {
    const binding = useChannelMessagingBinding('team');
    const name = useChannelName('team', 'Loading');
    const type = useChannelType('team');
    return (
      <>
        <output>{binding.value() ?? 'waiting'}</output>
        <span data-testid="name">{name()}</span>
        <span data-testid="type">{type()}</span>
      </>
    );
  }
  const view = render(() => (
    <ChannelsContextProvider>
      <Binding />
    </ChannelsContextProvider>
  ));
  expect(view.getByRole('status').textContent).toBe('waiting');
  expect(mocks.native.mock.calls[0][0]()).toBe('team');
  expect(mocks.native.mock.calls[0][1]()).toBe(true);
  setNative({
    isPending: false,
    data: {
      messaging_binding: 'native',
      channel_name: 'Authoritative channel',
      channel_type: 'team',
    },
  });
  expect(view.getByRole('status').textContent).toBe('native');
  expect(view.getByTestId('name').textContent).toBe('Authoritative channel');
  expect(view.getByTestId('type').textContent).toBe('team');
});
