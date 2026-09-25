import { vi } from 'vitest';

export type FakeTrack = MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };

export function fakeTrack(kind: 'audio' | 'video'): FakeTrack {
  const track = {
    kind,
    readyState: 'live' as MediaStreamTrackState,
    stop: vi.fn(() => {
      track.readyState = 'ended';
    }),
  };
  return track as unknown as FakeTrack;
}

/** jsdom has no MediaStream; this covers what the prejoin media uses. */
export class FakeMediaStream {
  private tracks: MediaStreamTrack[];
  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }
  removeTrack(track: MediaStreamTrack) {
    this.tracks = this.tracks.filter((candidate) => candidate !== track);
  }
}

export function stubMediaStream() {
  vi.stubGlobal('MediaStream', FakeMediaStream);
}

/** Answers each request with fresh tracks for the kinds it asked for. */
export function fakeMediaAccess() {
  const tracks: FakeTrack[] = [];
  const request = vi.fn(async (constraints: MediaStreamConstraints) => {
    const kinds = [
      ...(constraints.audio ? (['audio'] as const) : []),
      ...(constraints.video ? (['video'] as const) : []),
    ];
    const created = kinds.map(fakeTrack);
    tracks.push(...created);
    return new FakeMediaStream(created) as unknown as MediaStream;
  });
  return { request, tracks };
}
