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
      playback.setRate(1.25);
      expect(video.playbackRate).toBe(1.25);
      playback.toggleMute();
      expect(video.muted).toBe(true);
      dispose();
    });
  });

  it('sets and clamps volume, restores audibility, and validates speed selections', () => {
    const video = document.createElement('video');
    let dispose!: () => void;
    const playback = createRoot((cleanup) => {
      dispose = cleanup;
      return createRecordingPlayback(() => video);
    });
    playback.setVolume(0.4);
    // Drag callbacks read controlled state before native volumechange fires.
    expect(playback.volume()).toBe(0.4);
    playback.setVolume(0);
    video.dispatchEvent(new Event('volumechange'));
    playback.toggleMute();
    expect(video.volume).toBe(0.4);
    expect(video.muted).toBe(false);
    playback.toggleMute();
    expect(video.muted).toBe(true);
    playback.setVolume(0.6);
    expect(video.muted).toBe(false);
    expect(playback.volume()).toBe(0.6);
    expect(playback.muted()).toBe(false);
    playback.setVolume(5);
    expect(video.volume).toBe(1);
    playback.setVolume(-1);
    expect(video.volume).toBe(0);
    playback.setVolume(Number.NaN);
    expect(video.volume).toBe(0);
    playback.setRate(1.75);
    video.dispatchEvent(new Event('ratechange'));
    expect(playback.rate()).toBe(1.75);
    playback.setRate(100);
    expect(video.playbackRate).toBe(1.75);
    dispose();
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
