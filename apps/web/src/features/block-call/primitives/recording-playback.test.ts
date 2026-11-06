// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createRecordingPlayback } from './recording-playback';

describe('recording playback', () => {
  it('clamps seeking and drives the same media element from every control', () => {
    createRoot((dispose) => {
      const video = document.createElement('video');
      Object.defineProperty(video, 'duration', { value: 60 });
      const play = vi.spyOn(video, 'play').mockResolvedValue();
      const playback = createRecordingPlayback(() => video);
      playback.seek(55);
      playback.skip(10);
      expect(video.currentTime).toBe(60);
      playback.skip(-100);
      expect(video.currentTime).toBe(0);
      playback.seek(Number.NaN);
      expect(video.currentTime).toBe(0);
      playback.toggle();
      expect(play).toHaveBeenCalledOnce();
      playback.cycleRate();
      expect(video.playbackRate).toBe(1.25);
      playback.toggleMute();
      expect(video.muted).toBe(true);
      dispose();
    });
  });

  it('detaches state listeners when the media element changes or the owner closes', () => {
    let setVideo!: (video: HTMLVideoElement) => HTMLVideoElement;
    let dispose!: () => void;
    const first = document.createElement('video');
    const second = document.createElement('video');
    const playback = createRoot((cleanup) => {
      dispose = cleanup;
      const [video, set] = createSignal(first);
      setVideo = set;
      return createRecordingPlayback(video);
    });
    first.currentTime = 12;
    first.dispatchEvent(new Event('timeupdate'));
    expect(playback.time()).toBe(12);
    setVideo(second);
    second.currentTime = 24;
    second.dispatchEvent(new Event('timeupdate'));
    expect(playback.time()).toBe(24);
    first.currentTime = 40;
    first.dispatchEvent(new Event('timeupdate'));
    expect(playback.time()).toBe(24);
    dispose();
    second.currentTime = 48;
    second.dispatchEvent(new Event('timeupdate'));
    expect(playback.time()).toBe(24);
  });
});
