/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CallMiniPlayer } from '../CallMiniPlayer';

const participant = { identity: 'local', getTrackPublication: () => undefined };
vi.mock('../CallContext', () => ({
  useCallContext: () => ({
    activeCallId: () => 'call-1',
    trackVersion: () => 0,
    room: () => ({
      localParticipant: participant,
      on: () => {},
      off: () => {},
    }),
    remoteParticipants: () => new Map(),
    isLocalSpeaking: () => false,
    isAudioMuted: () => true,
  }),
}));
vi.mock('@queries/call/call', () => ({
  useLiveCallRecordQuery: () => ({
    isSuccess: true,
    data: { channelName: 'Call' },
  }),
}));
vi.mock('@core/user', () => ({
  getDisplayName: () => '',
  tryMacroId: () => undefined,
}));
vi.mock('../CallLiveChip', () => ({ CallLiveChip: () => null }));
vi.mock('../CallQuickControls', () => ({ CallQuickControls: () => null }));
vi.mock('../TrackView', () => ({ TrackView: () => null }));
vi.mock('@ui', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(100, 100, 336, 250)
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function pointer(
  element: HTMLElement,
  type: string,
  id: number,
  x: number,
  primary = true
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: 110,
  });
  Object.defineProperties(event, {
    pointerId: { value: id },
    isPrimary: { value: primary },
  });
  element.dispatchEvent(event);
}

it('keeps the drag owned by its starting pointer', () => {
  render(() => <CallMiniPlayer onCollapse={() => {}} onOpenCall={() => {}} />);
  const player = screen.getByRole('region', { name: 'Call' });
  const header = player.querySelector('div');
  if (!header) throw new Error('Missing player header');
  header.setPointerCapture = vi.fn();
  pointer(header, 'pointerdown', 1, 110);
  pointer(header, 'pointerdown', 2, 400, false);
  pointer(header, 'pointermove', 2, 800, false);
  expect(player.style.left).toBe('100px');
  pointer(header, 'pointermove', 1, 160);
  expect(player.style.left).toBe('150px');
  pointer(header, 'pointerup', 2, 800, false);
  pointer(header, 'pointermove', 1, 180);
  expect(player.style.left).toBe('170px');
  pointer(header, 'pointerup', 1, 180);
  pointer(header, 'pointermove', 1, 220);
  expect(player.style.left).toBe('170px');
});
