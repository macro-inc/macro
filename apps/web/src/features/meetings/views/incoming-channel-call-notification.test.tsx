import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { IncomingChannelCall } from '../core/incoming-channel-calls';
import { IncomingChannelCallNotification } from './incoming-channel-call-notification';

vi.mock('@channel/Call/CallStartedNotifier', () => ({
  MAX_RING_DURATION_MS: 30_000,
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));

afterEach(cleanup);

function ringingCall(place: IncomingChannelCall['place']): IncomingChannelCall {
  return {
    callId: 'call-1',
    channelId: 'channel-1',
    callerId: 'macro|ada@example.com',
    callerName: 'Ada Lovelace',
    place,
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  };
}

it('names the caller and the channel they are calling in', () => {
  render(() => (
    <IncomingChannelCallNotification
      call={ringingCall({ kind: 'channel', name: 'design' })}
      onJoin={vi.fn()}
      onDecline={vi.fn()}
    />
  ));

  expect(screen.getByRole('heading', { name: 'Ada Lovelace' })).toBeTruthy();
  expect(screen.getByText('Calling you in #design')).toBeTruthy();
});

it('says a direct message call is calling you', () => {
  render(() => (
    <IncomingChannelCallNotification
      call={ringingCall({ kind: 'direct' })}
      onJoin={vi.fn()}
      onDecline={vi.fn()}
    />
  ));

  expect(screen.getByText('Calling you')).toBeTruthy();
});

it('joins or declines only the action pressed', async () => {
  const onJoin = vi.fn();
  const onDecline = vi.fn();
  render(() => (
    <IncomingChannelCallNotification
      call={ringingCall({ kind: 'direct' })}
      onJoin={onJoin}
      onDecline={onDecline}
    />
  ));

  await userEvent.click(
    screen.getByRole('button', { name: 'Join call from Ada Lovelace' })
  );
  expect(onJoin).toHaveBeenCalledOnce();
  expect(onDecline).not.toHaveBeenCalled();

  await userEvent.click(
    screen.getByRole('button', { name: 'Decline call from Ada Lovelace' })
  );
  expect(onDecline).toHaveBeenCalledOnce();
  expect(onJoin).toHaveBeenCalledOnce();
});
