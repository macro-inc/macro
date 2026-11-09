import { RemoteParticipant, Room, Track } from 'livekit-client';
import { createComputed, createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { createCallVolumeState } from '../call-volume';

it('publishes microphone-only volume to every observer and resets with a new participant', () => {
  createRoot((dispose) => {
    const participant = new RemoteParticipant(
      new Room().engine.client,
      'remote-sid',
      'remote'
    );
    const volume = createCallVolumeState();
    let tileMuted = false;
    let rosterMuted = false;
    createComputed(() => {
      tileMuted = volume.level(participant) === 0;
    });
    createComputed(() => {
      rosterMuted = volume.level(participant) === 0;
    });
    volume.set(participant, 0);
    expect(tileMuted).toBe(true);
    expect(rosterMuted).toBe(true);
    expect(
      participant.getVolume(Track.Source.ScreenShareAudio)
    ).toBeUndefined();
    volume.set(participant, 0.5);
    expect(tileMuted).toBe(false);
    expect(rosterMuted).toBe(false);
    volume.set(participant, Number.NaN);
    expect(volume.level(participant)).toBe(0.5);
    const next = new RemoteParticipant(
      new Room().engine.client,
      'next-sid',
      'remote'
    );
    expect(volume.level(next)).toBe(1);
    dispose();
  });
});

it('does not interpret an unset SDK gain as a personal mute', () => {
  createRoot((dispose) => {
    const volume = createCallVolumeState();
    const participant = new RemoteParticipant(
      new Room().engine.client,
      'remote-sid',
      'remote'
    );
    expect(volume.level(participant)).toBe(1);
    participant.setVolume(0, Track.Source.Microphone);
    expect(volume.level(participant)).toBe(1);
    volume.set(participant, 0);
    expect(volume.level(participant)).toBe(0);
    volume.set(participant, 1);
    expect(volume.level(participant)).toBe(1);
    const other = new RemoteParticipant(
      new Room().engine.client,
      'other-sid',
      'other'
    );
    expect(volume.level(other)).toBe(1);
    dispose();
  });
});
