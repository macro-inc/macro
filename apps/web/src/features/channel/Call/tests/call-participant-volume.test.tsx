/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { RemoteParticipant, Room, Track } from 'livekit-client';
import { afterEach, expect, it, vi } from 'vitest';
import {
  CallParticipantVolume,
  supportsParticipantVolume,
} from '../CallParticipantVolume';

const platform = vi.hoisted(() => ({
  native: undefined as 'ios' | 'android' | undefined,
  mobile: false,
}));
vi.mock('@core/util/platform', () => ({
  getNativeMobilePlatform: () => platform.native,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => platform.mobile }));
afterEach(() => {
  platform.native = undefined;
  platform.mobile = false;
  vi.restoreAllMocks();
});

it('changes only microphone playback and retains the value when controls remount', async () => {
  const participant = new RemoteParticipant(
    new Room().engine.client,
    'remote-sid',
    'remote'
  );
  const setVolume = vi.spyOn(participant, 'setVolume');
  const view = render(() => (
    <CallParticipantVolume participant={participant} name="Guest" />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
  const slider = (await screen.findAllByRole('slider', { name: 'Volume' }))[0];
  slider.focus();
  fireEvent.keyDown(slider, { key: 'ArrowLeft' });
  expect(setVolume).toHaveBeenLastCalledWith(0.99, Track.Source.Microphone);
  expect(participant.getVolume(Track.Source.ScreenShareAudio)).toBeUndefined();
  fireEvent.keyDown(slider, { key: 'Escape' });
  view.unmount();
  render(() => (
    <CallParticipantVolume participant={participant} name="Guest" />
  ));
  fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
  expect(screen.getByText('99%').textContent).toBe('99%');
  expect(
    new RemoteParticipant(
      new Room().engine.client,
      'next-sid',
      'remote'
    ).getVolume(Track.Source.Microphone)
  ).toBeUndefined();
});

it('does not expose native, phone or read-only browser volume controls', () => {
  expect(supportsParticipantVolume()).toBe(true);
  platform.native = 'ios';
  expect(supportsParticipantVolume()).toBe(false);
  platform.native = 'android';
  expect(supportsParticipantVolume()).toBe(false);
  platform.native = undefined;
  vi.spyOn(HTMLMediaElement.prototype, 'volume', 'get').mockReturnValue(1);
  expect(supportsParticipantVolume()).toBe(false);
});
