import { describe, expect, it } from 'vitest';
import {
  AUTO_REJOIN_MAX_SCHEDULING_LAG_MS,
  type AutoRejoinAttempt,
  checkAutoRejoinTarget,
  checkAutoRejoinTiming,
} from '../auto-rejoin';

const CHANNEL_ID = 'channel-1';
const CALL_ID = 'call-1';
const SCHEDULED_AT = 1_700_000_000_000;

function attempt(overrides?: Partial<AutoRejoinAttempt>): AutoRejoinAttempt {
  return {
    channelId: CHANNEL_ID,
    callId: CALL_ID,
    scheduledAt: SCHEDULED_AT,
    ...overrides,
  };
}

describe('auto-rejoin timing', () => {
  it('allows a rejoin that runs when it was scheduled to', () => {
    expect(
      checkAutoRejoinTiming({
        attempt: attempt(),
        now: SCHEDULED_AT + 750,
        currentChannelId: CHANNEL_ID,
      })
    ).toBeNull();
  });

  it('refuses a rejoin whose timer was frozen by a sleeping device', () => {
    // The lid closes mid-call; the timer thaws the next morning.
    expect(
      checkAutoRejoinTiming({
        attempt: attempt(),
        now: SCHEDULED_AT + 14 * 60 * 60 * 1000,
        currentChannelId: CHANNEL_ID,
      })
    ).toBe('device_suspended');
  });

  it('refuses a rejoin just past the scheduling budget', () => {
    expect(
      checkAutoRejoinTiming({
        attempt: attempt(),
        now: SCHEDULED_AT + AUTO_REJOIN_MAX_SCHEDULING_LAG_MS + 1,
        currentChannelId: CHANNEL_ID,
      })
    ).toBe('device_suspended');
  });

  it('refuses a rejoin when the clock jumped backwards', () => {
    expect(
      checkAutoRejoinTiming({
        attempt: attempt(),
        now: SCHEDULED_AT - 1,
        currentChannelId: CHANNEL_ID,
      })
    ).toBe('device_suspended');
  });

  it('refuses a rejoin once the hook tracks another channel', () => {
    expect(
      checkAutoRejoinTiming({
        attempt: attempt(),
        now: SCHEDULED_AT + 750,
        currentChannelId: 'channel-2',
      })
    ).toBe('channel_changed');
  });
});

describe('auto-rejoin target', () => {
  it('allows a rejoin into the same still-running call', () => {
    expect(
      checkAutoRejoinTarget({
        attempt: attempt(),
        activeCall: { callId: CALL_ID },
      })
    ).toBeNull();
  });

  it('refuses to re-create a call that has already ended', () => {
    expect(
      checkAutoRejoinTarget({ attempt: attempt(), activeCall: null })
    ).toBe('call_ended');
  });

  it('refuses to join a different call that started in the meantime', () => {
    expect(
      checkAutoRejoinTarget({
        attempt: attempt(),
        activeCall: { callId: 'call-2' },
      })
    ).toBe('call_replaced');
  });

  it('refuses when the active-call lookup failed', () => {
    expect(
      checkAutoRejoinTarget({ attempt: attempt(), activeCall: 'unavailable' })
    ).toBe('lookup_failed');
  });

  it('refuses when the dropped call id is unknown, even with a live call', () => {
    expect(
      checkAutoRejoinTarget({
        attempt: attempt({ callId: null }),
        activeCall: { callId: 'call-2' },
      })
    ).toBe('call_unknown');
  });

  it('refuses with an unknown call id when nothing is live', () => {
    expect(
      checkAutoRejoinTarget({
        attempt: attempt({ callId: null }),
        activeCall: null,
      })
    ).toBe('call_ended');
  });
});
