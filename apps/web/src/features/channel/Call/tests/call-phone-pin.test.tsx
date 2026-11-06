/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { LocalParticipantTile } from '../CallParticipantTiles';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@core/user', () => ({
  getDisplayName: () => 'Guest',
  tryMacroId: () => undefined,
}));
vi.mock('../TrackView', () => ({
  TrackView: () => <video data-testid="camera" />,
}));

afterEach(() => vi.useRealTimers());

it('keeps taps inert and opens a cancellable pin menu only after a held touch', async () => {
  vi.useFakeTimers();
  const toggle = vi.fn();
  const [pinned, setPinned] = createSignal(false);
  const { container } = render(() => (
    <div data-call-participant-stage>
      <LocalParticipantTile
        identity="self"
        isSpeaking={false}
        isConnecting={false}
        isAudioMuted={false}
        isVideoMuted={false}
        track={undefined}
        userId={undefined}
        fallbackName="You"
        isProgram={false}
        pinEnabled
        isPinned={pinned()}
        onTogglePin={() => {
          toggle();
          setPinned((value) => !value);
        }}
      />
    </div>
  ));
  const tile = container.querySelector('[data-call-tile]')!;
  const video = screen.getByTestId('camera');
  fireEvent.click(tile);
  expect(toggle).not.toHaveBeenCalled();
  fireEvent.touchStart(tile, { touches: [{ clientX: 20, clientY: 20 }] });
  fireEvent.touchMove(tile, { touches: [{ clientX: 50, clientY: 20 }] });
  await vi.advanceTimersByTimeAsync(500);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.touchStart(tile, { touches: [{ clientX: 20, clientY: 20 }] });
  await vi.advanceTimersByTimeAsync(500);
  fireEvent.touchEnd(tile);
  expect(screen.getByRole('dialog', { name: 'You' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
  expect(toggle).toHaveBeenCalledOnce();
  expect(screen.getByTestId('camera')).toBe(video);
  expect(screen.getByRole('button', { name: 'Unpin You' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Unpin You' }));
  expect(toggle).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Pin You' })).toBeNull();
});
