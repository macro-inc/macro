import { render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { expect, it, vi } from 'vitest';
import { ChannelCallAutoJoin } from '../ChannelCallAutoJoin';
import type { CallJoinIntent } from '../call-lifecycle';

const call = vi.hoisted(() => ({
  isJoining: (): boolean => false,
  joinCall: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/constant/featureFlags')>()),
  ENABLE_CALLS: true,
}));
vi.mock('@channel/Channel/ChannelTabContext', () => ({
  useChannelTab: () => ({ setActiveTab: vi.fn() }),
}));
vi.mock('../use-call', () => ({
  useCall: () => ({ ...call, isLeaving: () => false }),
}));

it('retains a newer navigation target while an earlier join fails', async () => {
  const first: CallJoinIntent = { kind: 'join', callId: 'first-call' };
  const second: CallJoinIntent = { kind: 'join', callId: 'second-call' };
  const [intent, setIntent] = createSignal<CallJoinIntent | undefined>(first);
  const [joining, setJoining] = createSignal(false);
  call.isJoining = joining;
  let rejectFirst!: (error: Error) => void;
  let resolveSecond!: () => void;
  call.joinCall.mockImplementationOnce(() => {
    setJoining(true);
    return new Promise<void>((_, reject) => {
      rejectFirst = reject;
    });
  });
  call.joinCall.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        resolveSecond = resolve;
      })
  );
  const handled = vi.fn(() => setIntent(undefined));
  const view = render(() => (
    <ChannelCallAutoJoin
      channelId="channel-id"
      pendingJoinCall={intent}
      onHandled={handled}
    />
  ));
  await waitFor(() => expect(call.joinCall).toHaveBeenCalledTimes(1));
  setIntent(second);
  expect(handled).not.toHaveBeenCalled();
  rejectFirst(new Error('First call ended'));
  setJoining(false);
  await waitFor(() => expect(call.joinCall).toHaveBeenCalledTimes(2));
  expect(call.joinCall).toHaveBeenLastCalledWith('deep_link', second);
  expect(handled).not.toHaveBeenCalled();
  resolveSecond();
  await waitFor(() => expect(handled).toHaveBeenCalledOnce());
  view.unmount();
});
