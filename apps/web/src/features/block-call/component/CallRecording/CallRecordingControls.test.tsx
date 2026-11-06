// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, Show } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRecordingControlsVisibility } from '../../primitives/recording-controls';
import { createRecordingPlayback } from '../../primitives/recording-playback';
import { CallRecordingControls } from './CallRecordingControls';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('selects a playback speed and adjusts native volume with keyboard controls', async () => {
  const video = document.createElement('video');
  render(() => {
    const playback = createRecordingPlayback(() => video);
    const visibility = createRecordingControlsVisibility(playback.paused);
    return (
      <div class="portal-scope">
        <CallRecordingControls playback={playback} visibility={visibility} />
      </div>
    );
  });

  fireEvent.keyDown(screen.getByRole('button', { name: 'Playback speed' }), {
    key: 'Enter',
  });
  fireEvent.keyDown(
    await screen.findByRole('menuitemradio', { name: '1.5×' }),
    { key: 'Enter' }
  );
  expect(video.playbackRate).toBe(1.5);
  video.dispatchEvent(new Event('ratechange'));
  expect(
    (await screen.findByRole('button', { name: 'Playback speed' })).textContent
  ).toBe('1.5×');

  fireEvent.focus(screen.getByRole('button', { name: 'Mute' }));
  const volume = screen.getByRole('slider', { name: 'Volume' });
  fireEvent.keyDown(volume, { key: 'ArrowDown' });
  expect(video.volume).toBeCloseTo(0.95);
  video.dispatchEvent(new Event('volumechange'));
  fireEvent.click(screen.getByRole('button', { name: 'Mute' }));
  expect(video.muted).toBe(true);
  video.dispatchEvent(new Event('volumechange'));
  fireEvent.keyDown(volume, { key: 'ArrowUp' });
  expect(video.volume).toBeCloseTo(0.05);
  expect(video.muted).toBe(false);
});

it('releases the menu visibility hold when controls unmount during playback', async () => {
  vi.useFakeTimers();
  const video = document.createElement('video');
  Object.defineProperty(video, 'paused', { value: false });
  let removeControls!: () => void;
  let visible!: () => boolean;
  render(() => {
    const playback = createRecordingPlayback(() => video);
    const visibility = createRecordingControlsVisibility(playback.paused);
    const [mounted, setMounted] = createSignal(true);
    removeControls = () => setMounted(false);
    visible = visibility.visible;
    return (
      <Show when={mounted()}>
        <CallRecordingControls playback={playback} visibility={visibility} />
      </Show>
    );
  });
  fireEvent.keyDown(screen.getByRole('button', { name: 'Playback speed' }), {
    key: 'Enter',
  });
  await vi.advanceTimersByTimeAsync(1);
  expect(screen.getByRole('menu')).toBeTruthy();
  await vi.advanceTimersByTimeAsync(3000);
  expect(visible()).toBe(true);
  removeControls();
  await vi.advanceTimersByTimeAsync(3000);
  expect(screen.queryByRole('menu')).toBeNull();
  expect(visible()).toBe(false);
});

it('opens volume without consuming mute clicks and restores focus on Escape', async () => {
  const video = document.createElement('video');
  render(() => {
    const playback = createRecordingPlayback(() => video);
    const visibility = createRecordingControlsVisibility(playback.paused);
    return (
      <CallRecordingControls playback={playback} visibility={visibility} />
    );
  });
  const mute = screen.getByRole('button', { name: 'Mute' });
  mute.focus();
  const volume = await screen.findByRole('slider', { name: 'Volume' });
  fireEvent.keyDown(mute, { key: 'Tab' });
  await Promise.resolve();
  expect(document.activeElement).toBe(volume);
  fireEvent.keyDown(volume, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(mute);
  fireEvent.keyDown(mute, { key: 'Tab' });
  await Promise.resolve();
  fireEvent.keyDown(volume, { key: 'Tab' });
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Fullscreen' })
  );
  mute.focus();
  fireEvent.click(mute);
  expect(video.muted).toBe(true);
  video.dispatchEvent(new Event('volumechange'));
  fireEvent.click(screen.getByRole('button', { name: 'Unmute' }));
  expect(video.muted).toBe(false);
  fireEvent.keyDown(mute, { key: 'ArrowUp' });
  await Promise.resolve();
  expect(document.activeElement).toBe(volume);
  fireEvent.keyDown(volume, { key: 'Escape' });
  await Promise.resolve();
  expect(document.activeElement).toBe(mute);
});
