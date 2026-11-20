import { waitFor } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createIncomingChannelCalls } from './incoming-channel-calls';

const mocks = vi.hoisted(() => ({
  joinChannelCall: vi.fn(),
  dismissIncomingCallEverywhere: vi.fn(),
  toastFailure: vi.fn(),
  ringing: undefined as
    | undefined
    | (() => {
        channelId: string;
        callId: string;
        createdAt: string;
        createdBy: string | null;
      }[]),
  splitManager: { current: {} as object | undefined },
  openChannels: undefined as undefined | (() => string[]),
}));

vi.mock('@app/features/block-call/sidebar/incoming-calls', () => ({
  dismissIncomingCallEverywhere: mocks.dismissIncomingCallEverywhere,
  useVisibleIncomingCalls: () => mocks.ringing,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => mocks.splitManager.current,
}));
vi.mock('@channel/Call/join-channel-call', () => ({
  joinChannelCall: mocks.joinChannelCall,
}));
vi.mock('@channel/Call/CallStartedNotifier', () => ({
  MAX_RING_DURATION_MS: 30_000,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.toastFailure },
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({
    channelsById: () => ({
      design: { name: 'design', channel_type: 'public' },
      dm: { name: 'Ada Lovelace', channel_type: 'direct_message' },
      group: { name: 'Ada, Grace, Alan, Edsger', channel_type: 'private' },
    }),
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|me@example.com',
}));
vi.mock('@core/user/util', () => ({
  idToDisplayName: (id: string) =>
    id === 'macro|ada@example.com' ? 'Ada Lovelace' : '',
}));

const RINGING = [
  {
    channelId: 'design',
    callId: 'call-design',
    createdAt: '2026-11-18T12:00:00.000Z',
    createdBy: 'macro|ada@example.com',
  },
  {
    channelId: 'dm',
    callId: 'call-dm',
    createdAt: '2026-11-18T12:00:01.000Z',
    createdBy: 'macro|ada@example.com',
  },
  {
    channelId: 'group',
    callId: 'call-group',
    createdAt: '2026-11-18T12:00:02.000Z',
    createdBy: null,
  },
];
const [ringing, setRinging] = createSignal(RINGING);
mocks.ringing = ringing;
const [openChannels, setOpenChannels] = createSignal<string[]>([]);
mocks.openChannels = openChannels;

/** A split manager whose open conversations follow `openChannels`. */
const SPLIT_MANAGER = {
  findOpenView: (content: { type: string; id: string }) =>
    content.type === 'channel' && openChannels().includes(content.id)
      ? { owner: 'split-1', content }
      : undefined,
};

let dispose = () => {};

function create() {
  return createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createIncomingChannelCalls();
  });
}

beforeEach(() => {
  mocks.joinChannelCall.mockReset();
  mocks.dismissIncomingCallEverywhere.mockReset();
  mocks.toastFailure.mockReset();
  mocks.splitManager.current = SPLIT_MANAGER;
  setOpenChannels([]);
  setRinging(RINGING);
});

afterEach(() => dispose());

it('describes each ringing call by its caller and place', () => {
  const calls = create().calls();

  expect(
    calls.map((call) => ({
      callId: call.callId,
      callerName: call.callerName,
      place: call.place,
      expiresAt: call.expiresAt,
    }))
  ).toEqual([
    {
      callId: 'call-design',
      callerName: 'Ada Lovelace',
      place: { kind: 'channel', name: 'design' },
      expiresAt: '2026-11-18T12:00:30.000Z',
    },
    {
      callId: 'call-dm',
      callerName: 'Ada Lovelace',
      place: { kind: 'direct' },
      expiresAt: '2026-11-18T12:00:31.000Z',
    },
    {
      callId: 'call-group',
      callerName: '',
      place: { kind: 'direct' },
      expiresAt: '2026-11-18T12:00:32.000Z',
    },
  ]);
});

it('keeps a call the same while other calls come and go', () => {
  const incoming = create();
  const before = incoming.calls()[1];

  setRinging((calls) => calls.filter((call) => call.callId !== 'call-design'));

  expect(incoming.calls()[0]).toBe(before);
});

it('joins the ringing call in its channel', async () => {
  mocks.joinChannelCall.mockResolvedValue(undefined);
  const incoming = create();

  incoming.join(incoming.calls()[0]);

  expect(mocks.joinChannelCall).toHaveBeenCalledWith('design', {
    kind: 'join',
    callId: 'call-design',
  });
  await Promise.resolve();
  expect(mocks.toastFailure).not.toHaveBeenCalled();
});

it('tells the user when joining fails', async () => {
  mocks.joinChannelCall.mockRejectedValue(new Error('ended'));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const incoming = create();

  incoming.join(incoming.calls()[0]);

  await waitFor(() =>
    expect(mocks.toastFailure).toHaveBeenCalledWith('Failed to join call')
  );
});

it('declines the call on every device for the current user', () => {
  const incoming = create();

  incoming.decline(incoming.calls()[0]);

  expect(mocks.dismissIncomingCallEverywhere).toHaveBeenCalledWith(
    'call-design',
    'macro|me@example.com'
  );
  expect(mocks.joinChannelCall).not.toHaveBeenCalled();
});

it('leaves calls to the Chat sidebar where joining has no split layout', () => {
  mocks.splitManager.current = undefined;

  expect(create().calls()).toEqual([]);
});

const ringingIds = (incoming: ReturnType<typeof create>) =>
  incoming.calls().map((call) => call.callId);

it('hides a call while its conversation is open on screen', () => {
  setOpenChannels(['design']);

  expect(ringingIds(create())).toEqual(['call-dm', 'call-group']);
});

it('shows the call again as soon as its conversation is closed', () => {
  const incoming = create();
  setOpenChannels(['design']);
  expect(ringingIds(incoming)).not.toContain('call-design');

  setOpenChannels(['dm']);
  expect(ringingIds(incoming)).toEqual(['call-design', 'call-group']);

  setOpenChannels([]);
  expect(ringingIds(incoming)).toEqual([
    'call-design',
    'call-dm',
    'call-group',
  ]);
});

it('keeps a call the same object while it is hidden and shown again', () => {
  const incoming = create();
  const before = incoming.calls()[0];
  setOpenChannels(['design']);
  setOpenChannels([]);

  expect(incoming.calls()[0]).toBe(before);
});
