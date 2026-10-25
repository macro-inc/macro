/** @vitest-environment jsdom */
import type { BackgroundEffect } from '@core/media/background-effect';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CallMediaControls,
  type CallMediaControlsState,
} from '../CallControls/CallMediaControls';

afterEach(cleanup);

const device = (deviceId: string, label: string) =>
  ({ deviceId, label }) as MediaDeviceInfo;

function setup() {
  const [audioMuted, setAudioMuted] = createSignal(false);
  const [background, setBackground] = createSignal<BackgroundEffect>({
    type: 'none',
  });
  const media = {
    isConnecting: () => false,
    isAudioMuted: audioMuted,
    isVideoMuted: () => false,
    isScreenSharing: () => false,
    toggleAudio: vi.fn(async () => {
      setAudioMuted(!audioMuted());
    }),
    toggleVideo: vi.fn(async () => {}),
    toggleScreenShare: vi.fn(async () => {}),
    audioInputDevices: () => [device('mic-1', 'Desk microphone')],
    audioOutputDevices: () => [],
    videoInputDevices: () => [device('cam-1', 'Desk camera')],
    activeAudioInputDeviceId: () => null,
    activeAudioOutputDeviceId: () => null,
    activeVideoInputDeviceId: () => 'cam-1',
    switchAudioInput: vi.fn(async () => {}),
    switchAudioOutput: vi.fn(async () => {}),
    switchVideoInput: vi.fn(async () => {}),
    isNoiseSuppressed: () => true,
    toggleNoiseSuppression: vi.fn(async () => {}),
    backgroundEffect: background,
    setBackgroundEffect: vi.fn(async (effect: BackgroundEffect) => {
      setBackground(effect);
    }),
  } satisfies CallMediaControlsState;
  const leave = vi.fn();
  render(() => <CallMediaControls media={media} onLeave={leave} />);
  return { media, leave };
}

async function openMenu(name: string) {
  const trigger = screen.getByRole('button', { name });
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await screen.findByRole('menu');
  return trigger;
}

async function choose(role: string, name: string) {
  const item = await screen.findByRole(role, { name });
  item.focus();
  fireEvent.keyDown(item, { key: 'Enter' });
}

describe('call controls', () => {
  it('toggles the microphone without opening its settings', () => {
    const { media } = setup();
    const toggle = screen.getByRole('button', { name: 'Mute microphone' });
    fireEvent.pointerEnter(toggle);
    fireEvent.click(toggle);
    expect(media.toggleAudio).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(
      screen
        .getByRole('button', { name: 'Unmute microphone' })
        .getAttribute('aria-pressed')
    ).toBe('false');
  });

  it('opens audio settings from the caret and switches the microphone', async () => {
    const { media } = setup();
    const caret = await openMenu('Audio settings');
    expect(caret.getAttribute('aria-expanded')).toBe('true');
    await choose('menuitemradio', 'Desk microphone');
    expect(media.switchAudioInput).toHaveBeenCalledWith('mic-1');
  });

  it('keeps background effects in the video settings', async () => {
    const { media } = setup();
    await openMenu('Video settings');
    expect(
      screen
        .getByRole('menuitemradio', { name: 'Desk camera' })
        .getAttribute('aria-checked')
    ).toBe('true');
    await choose('menuitemradio', 'Strong blur');
    await waitFor(() =>
      expect(media.setBackgroundEffect).toHaveBeenCalledWith({
        type: 'blur',
        intensity: 'heavy',
      })
    );
  });

  it('leaves the call', () => {
    const { leave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(leave).toHaveBeenCalledOnce();
  });
});
