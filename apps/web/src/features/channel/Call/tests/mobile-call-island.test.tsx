/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { MobileCallIsland } from '../MobileCallIsland';

const mocks = vi.hoisted(() => ({ call: undefined as unknown }));
vi.mock('../CallContext', () => ({
  useCallContextOptional: () => mocks.call,
}));
vi.mock('../use-active-call-companion', () => ({
  useActiveCallCompanion: () => ({
    inCallView: () => false,
    open: async () => {},
  }),
}));
vi.mock('@components/app/mobile/float-regions/FloatRegion', () => ({
  FloatRegion: (props: { children: JSX.Element }) => props.children,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/virtualKeyboard', () => ({
  virtualKeyboardVisible: () => false,
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => '',
  tryMacroId: (id: string) => id || undefined,
}));
vi.mock('@queries/call/call', () => ({
  useLiveCallRecordQuery: () => ({
    isSuccess: true,
    data: { channelName: 'Channel', startedAt: '2026-01-01T00:00:00Z' },
  }),
}));
vi.mock('../CallLiveChip', () => ({ CallLiveChip: () => null }));
vi.mock('../CallQuickControls', () => ({ CallQuickControls: () => null }));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));
afterEach(cleanup);

it('shows the local avatar during local speech instead of highlighting a remote attendee', () => {
  const [localSpeaking, setLocalSpeaking] = createSignal(false);
  mocks.call = {
    isInCall: () => true,
    activeCallId: () => 'call-1',
    isLocalSpeaking: localSpeaking,
    isParticipantSpeaking: () => false,
    remoteParticipants: () =>
      new Map([['remote', { identity: 'remote', name: 'Remote' }]]),
  };
  render(() => <MobileCallIsland />);
  expect(screen.getByText('R')).toBeTruthy();
  setLocalSpeaking(true);
  expect(screen.queryByText('R')).toBeNull();
  expect(screen.getByText('Y')).toBeTruthy();
  setLocalSpeaking(false);
  expect(screen.getByText('R')).toBeTruthy();
});
