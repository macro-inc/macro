import { parseCallJoinIntent } from '@channel/Channel/link';
import { beforeEach, expect, it, vi } from 'vitest';
import { joinChannelCall } from '../join-channel-call';

const navigation = vi.hoisted(() => ({
  activate: vi.fn(),
  goToLocationFromParams: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    getSplitByContent: () => ({ activate: navigation.activate }),
    getOrchestrator: () => ({
      getBlockHandle: async () => ({
        goToLocationFromParams: navigation.goToLocationFromParams,
      }),
    }),
  }),
}));

beforeEach(() => vi.clearAllMocks());

it('preserves the selected session through channel navigation', async () => {
  const callId = '01991b2a-f4e0-7000-a000-111111111111';
  await joinChannelCall('channel-id', { kind: 'join', callId });
  const [params] = navigation.goToLocationFromParams.mock.calls[0];
  expect(parseCallJoinIntent(params.join_call)).toEqual({
    kind: 'join',
    callId,
  });
});

it('keeps legacy channel-only links non-creating and Start explicitly creating', async () => {
  await joinChannelCall('channel-id');
  await joinChannelCall('channel-id', { kind: 'start' });
  const [[join], [start]] = navigation.goToLocationFromParams.mock.calls;
  expect(parseCallJoinIntent(join.join_call)).toEqual({ kind: 'join' });
  expect(parseCallJoinIntent(start.join_call)).toEqual({ kind: 'start' });
  expect(parseCallJoinIntent(false)).toBeUndefined();
  expect(parseCallJoinIntent('invalid-call-id')).toBeUndefined();
});
