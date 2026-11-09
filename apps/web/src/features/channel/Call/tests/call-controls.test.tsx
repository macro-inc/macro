/** @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import type { BackgroundEffect } from '@core/media/background-effect';
import { readBackgroundImage } from '@core/media/read-background-image';
import {
  loadRecentBackgroundImages,
  saveRecentBackgroundImage,
} from '@core/media/recent-background-images';
import { confirmDialog } from '@ui';

vi.mock('@core/media/read-background-image', () => ({
  readBackgroundImage: vi.fn(),
}));

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

vi.mock('@ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui')>()),
  confirmDialog: vi.fn(async () => false),
}));

afterEach(cleanup);

const device = (deviceId: string, label: string) =>
  ({ deviceId, label }) as MediaDeviceInfo;

function setup(unframed = false) {
  const [audioMuted, setAudioMuted] = createSignal(false);
  const [shareAudio, setShareAudio] = createSignal(false);
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
    shareScreenAudio: shareAudio,
    setShareScreenAudio: vi.fn(setShareAudio),
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
  render(() => (
    <CallMediaControls
      media={media}
      onLeave={leave}
      unframed={unframed}
      compact={unframed}
    />
  ));
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
  it('switches the microphone from the unframed quick row', async () => {
    const { media } = setup(true);
    await openMenu('Audio settings');
    await choose('menuitemradio', 'Desk microphone');
    expect(media.switchAudioInput).toHaveBeenCalledWith('mic-1');
  });

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
        .hasAttribute('aria-pressed')
    ).toBe(false);
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

  it('selects, reorders and removes inactive recent images from video settings', async () => {
    await saveRecentBackgroundImage({
      id: 'custom',
      path: 'data:image/jpeg;base64,AAAA',
    });
    await saveRecentBackgroundImage({
      id: 'custom',
      path: 'data:image/jpeg;base64,BBBB',
    });
    const { media } = setup();
    await openMenu('Video settings');
    const first = await screen.findByRole('menuitemradio', {
      name: 'Recent image 1',
    });
    first.focus();
    fireEvent.keyDown(first, { key: 'Enter' });
    await waitFor(() =>
      expect(media.setBackgroundEffect).toHaveBeenCalledWith({
        type: 'image',
        id: 'custom',
        path: 'data:image/jpeg;base64,BBBB',
      })
    );
    expect(
      screen.getAllByRole('button', { name: 'Remove from recent' })
    ).toHaveLength(2);
    fireEvent.keyDown(first, { key: 'Delete' });
    expect(
      (await loadRecentBackgroundImages()).map((image) => image.path)
    ).toContain('data:image/jpeg;base64,BBBB');
    const second = screen.getByRole('menuitemradio', {
      name: 'Recent image 2',
    });
    second.focus();
    fireEvent.keyDown(second, { key: 'Enter' });
    await waitFor(async () =>
      expect((await loadRecentBackgroundImages())[0]?.path).toBe(
        'data:image/jpeg;base64,AAAA'
      )
    );
    const selected = screen.getByRole('menuitemradio', {
      name: 'Recent image 1',
    });
    fireEvent.keyDown(selected, { key: 'Backspace' });
    expect((await loadRecentBackgroundImages())[0]?.path).toBe(
      'data:image/jpeg;base64,AAAA'
    );
    const inactive = screen.getByRole('menuitemradio', {
      name: 'Recent image 2',
    });
    fireEvent.keyDown(inactive, { key: 'Backspace' });
    await waitFor(() =>
      expect(
        screen.queryByRole('menuitemradio', { name: 'Recent image 2' })
      ).toBeNull()
    );
    expect(
      (await loadRecentBackgroundImages()).map((image) => image.path)
    ).not.toContain('data:image/jpeg;base64,BBBB');
  });

  it('removes an inactive image with the hover action', async () => {
    await saveRecentBackgroundImage({
      id: 'custom',
      path: 'data:image/jpeg;base64,DDDD',
    });
    setup();
    await openMenu('Video settings');
    await screen.findByRole('menuitemradio', { name: 'Recent image 2' });
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Remove from recent' })[0]
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('menuitemradio', { name: 'Recent image 2' })
      ).toBeNull()
    );
    expect(
      (await loadRecentBackgroundImages()).map((image) => image.path)
    ).not.toContain('data:image/jpeg;base64,DDDD');
  });

  it('confirms before removing the active background and keeps cancellation unchanged', async () => {
    await saveRecentBackgroundImage({
      id: 'active',
      path: 'data:image/jpeg;base64,ACTIVE',
    });
    const { media } = setup();
    await media.setBackgroundEffect({
      type: 'image',
      id: 'active',
      path: 'data:image/jpeg;base64,ACTIVE',
    });
    await openMenu('Video settings');
    const selected = await screen.findByRole('menuitemradio', {
      name: /Recent image/,
      checked: true,
    });
    fireEvent.keyDown(selected, { key: 'Delete' });
    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    expect(media.backgroundEffect().type).toBe('image');
    expect(
      (await loadRecentBackgroundImages()).some(
        (image) => image.id === 'active'
      )
    ).toBe(true);
    vi.mocked(confirmDialog).mockResolvedValueOnce(true);
    fireEvent.keyDown(selected, { key: 'Delete' });
    await waitFor(() => expect(media.backgroundEffect().type).toBe('none'));
    await waitFor(async () =>
      expect(
        (await loadRecentBackgroundImages()).some(
          (image) => image.id === 'active'
        )
      ).toBe(false)
    );
  });

  it('keeps an uploaded background applied when recent storage fails', async () => {
    vi.mocked(readBackgroundImage).mockResolvedValueOnce(
      'data:image/jpeg;base64,CCCC'
    );
    const { media } = setup();
    await openMenu('Video settings');
    await screen.findByRole('menuitemradio', { name: 'Recent image 1' });
    const transaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementationOnce(
      function (this: IDBDatabase, ...args) {
        if (args[1] === 'readwrite') throw new Error('Storage unavailable');
        return transaction.apply(this, args);
      }
    );
    const input = screen.getByLabelText('Upload background image', {
      selector: 'input',
    });
    fireEvent.change(input, {
      target: {
        files: [new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' })],
      },
    });
    await waitFor(() =>
      expect(media.setBackgroundEffect).toHaveBeenCalledWith({
        type: 'image',
        id: 'custom',
        path: 'data:image/jpeg;base64,CCCC',
      })
    );
    await waitFor(() =>
      expect(
        screen
          .getByRole('menuitem', { name: 'Upload background image' })
          .hasAttribute('disabled')
      ).toBe(false)
    );
    expect(
      (await loadRecentBackgroundImages()).some(
        (image) => image.path === 'data:image/jpeg;base64,CCCC'
      )
    ).toBe(false);
    vi.restoreAllMocks();
  });
  it('shares the screen without opening its settings', () => {
    const { media } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Share screen' }));
    expect(media.toggleScreenShare).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('chooses whether a screen share includes audio', async () => {
    const { media } = setup();
    await openMenu('Screen share settings');
    const item = screen.getByRole('menuitemcheckbox', { name: 'Share audio' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    await choose('menuitemcheckbox', 'Share audio');
    expect(media.setShareScreenAudio).toHaveBeenCalledWith(true);
    await waitFor(() => expect(item.getAttribute('aria-checked')).toBe('true'));
  });

  it('leaves the call', () => {
    const { leave } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Leave call' }));
    expect(leave).toHaveBeenCalledOnce();
  });
});
