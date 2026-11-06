import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { useCallSpeaking, useParticipantSpeaking } from '../use-call-speaking';

const mocks = vi.hoisted(() => ({ call: undefined as unknown }));
vi.mock('../CallContext', () => ({
  useCallContextOptional: () => mocks.call,
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'local-user' }));
afterEach(() => {
  mocks.call = undefined;
});

it('tracks local and remote speech only for the joined call', () => {
  createRoot((dispose) => {
    const [joined, setJoined] = createSignal(true);
    const [local, setLocal] = createSignal(false);
    const [remote, setRemote] = createSignal(false);
    mocks.call = {
      isInCall: joined,
      activeCallId: () => 'call-1',
      activeChannelId: () => 'channel-1',
      isLocalSpeaking: local,
      remoteParticipants: () => new Map([['remote', { isAgent: false }]]),
      isParticipantSpeaking: remote,
    };
    const speaking = useCallSpeaking();
    expect(speaking({ callId: 'call-1' })).toBe(false);
    setLocal(true);
    expect(speaking({ callId: 'call-1' })).toBe(true);
    expect(speaking({ channelId: 'channel-1' })).toBe(true);
    expect(speaking({ callId: 'another-call' })).toBe(false);
    expect(speaking({ channelId: 'another-channel' })).toBe(false);
    expect(speaking({})).toBe(false);
    setLocal(false);
    setRemote(true);
    expect(speaking({ callId: 'call-1' })).toBe(true);
    setJoined(false);
    expect(speaking({ callId: 'call-1' })).toBe(false);
    dispose();
  });
});

it('keeps calls still without a media owner', () => {
  expect(useCallSpeaking()({ callId: 'call-1' })).toBe(false);
});

it('maps speech to identities without highlighting users from other calls', () => {
  createRoot((dispose) => {
    const [local, setLocal] = createSignal(false);
    const [remote, setRemote] = createSignal(false);
    const [callId, setCallId] = createSignal('call-1');
    mocks.call = {
      isInCall: () => true,
      activeCallId: callId,
      activeChannelId: () => 'channel-1',
      room: () => undefined,
      isLocalSpeaking: local,
      remoteParticipants: () =>
        new Map([['remote-sid', { identity: 'remote-user' }]]),
      isParticipantSpeaking: remote,
    };
    const speaking = useParticipantSpeaking(() => ({ callId: 'call-1' }));
    expect(speaking('local-user')).toBe(false);
    setLocal(true);
    expect(speaking('local-user')).toBe(true);
    expect(speaking('remote-user')).toBe(false);
    setRemote(true);
    expect(speaking('remote-user')).toBe(true);
    expect(speaking('unknown-user')).toBe(false);
    setCallId('call-2');
    expect(speaking('local-user')).toBe(false);
    expect(speaking('remote-user')).toBe(false);
    dispose();
  });
});
