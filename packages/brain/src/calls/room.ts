import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  type Participant,
  ParticipantKind,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  Room,
  RoomEvent,
  TrackKind,
  type TrackPublication,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import type { Speaker } from './call.ts';
import type { Emit } from './events.ts';
import type { Conn } from './macro.ts';
export const IN_RATE = 16000;
export const IN_FRAME = 320; // 20 ms
export type RoomHandlers = {
  joined(who: string, name: string): void;
  left(who: string): void;
  audio(who: string, frame: Int16Array): void;
  trackEnded?(who: string): void;
  disconnected(reason: string): void;
};
const human = (p: Participant) => p.kind !== ParticipantKind.AGENT;
const label = (p: Participant) => p.identity;
export class SourceSpeaker implements Speaker {
  private queue: Int16Array[] = [];
  private pumping = false;
  private gen = 0;
  private gain = 1;
  private waiters: (() => void)[] = [];
  static readonly DUCK_GAIN = 0.2;
  readonly source: AudioSource;
  readonly rate: number;
  private onPlayed?: (pcm: Int16Array) => void;
  private onError: (error: unknown) => void;
  constructor(
    source: AudioSource,
    rate: number,
    onError: (error: unknown) => void,
    onPlayed?: (pcm: Int16Array) => void
  ) {
    this.source = source;
    this.rate = rate;
    this.onPlayed = onPlayed;
    this.onError = onError;
  }
  play(pcm: Int16Array) {
    const n = this.rate / 100;
    for (let i = 0; i < pcm.length; i += n) {
      const f = new Int16Array(n);
      f.set(pcm.subarray(i, i + n));
      this.queue.push(f);
    }
    if (!this.pumping) void this.pump();
  }
  private async pump() {
    this.pumping = true;
    const gen = this.gen;
    try {
      while (this.queue.length && gen === this.gen) {
        let f = this.queue.shift()!;
        if (this.gain !== 1) f = f.map((v) => Math.round(v * this.gain));
        await this.source.captureFrame(
          new AudioFrame(f, this.rate, 1, f.length)
        );
        this.onPlayed?.(f);
      }
    } catch (error) {
      this.queue = [];
      this.onError(error);
    } finally {
      this.pumping = false;
      if (this.queue.length) void this.pump();
      else for (const resolve of this.waiters.splice(0)) resolve();
    }
  }
  duck(on: boolean) {
    this.gain = on ? SourceSpeaker.DUCK_GAIN : 1;
  }
  clear() {
    this.gain = 1;
    this.gen++;
    this.queue = [];
    this.source.clearQueue();
  }
  async drained() {
    if (this.queue.length || this.pumping)
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    await this.source.waitForPlayout();
  }
}
export class CallRoom {
  readonly room = new Room();
  private listening = new Set<string>(); // track sids
  private source: AudioSource | null = null;
  private emit: Emit;
  private h: RoomHandlers;
  constructor(emit: Emit, h: RoomHandlers) {
    this.emit = emit;
    this.h = h;
  }
  async connect(conn: Conn) {
    const r = this.room;
    r.on(RoomEvent.ParticipantConnected, (p: RemoteParticipant) => {
      this.emit('room.participant_joined', {
        who: label(p),
        name: p.name,
        kind: p.kind,
      });
      if (human(p)) this.h.joined(label(p), p.name || label(p));
    });
    r.on(RoomEvent.ParticipantDisconnected, (p: RemoteParticipant) => {
      this.emit('room.participant_left', { who: label(p) });
      if (human(p)) this.h.left(label(p));
    });
    r.on(
      RoomEvent.TrackPublished,
      (pub: RemoteTrackPublication, p: RemoteParticipant) =>
        this.emit('room.track_published', {
          who: label(p),
          kind: pub.kind,
          source: pub.source,
          sid: pub.sid,
          muted: pub.muted,
        })
    );
    r.on(
      RoomEvent.TrackSubscribed,
      (t: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) =>
        this.subscribed(t, pub, p)
    );
    r.on(
      RoomEvent.TrackUnsubscribed,
      (_t: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) =>
        this.emit('room.track_unsubscribed', { who: label(p), sid: pub.sid })
    );
    r.on(
      RoomEvent.TrackSubscriptionFailed,
      (sid: string, p: RemoteParticipant, reason?: string) =>
        this.emit('room.track_subscription_failed', {
          who: label(p),
          sid,
          reason,
        })
    );
    r.on(RoomEvent.TrackMuted, (pub: TrackPublication, p: Participant) =>
      this.emit('room.track_muted', { who: label(p), sid: pub.sid })
    );
    r.on(RoomEvent.TrackUnmuted, (pub: TrackPublication, p: Participant) =>
      this.emit('room.track_unmuted', { who: label(p), sid: pub.sid })
    );
    r.on(RoomEvent.ActiveSpeakersChanged, (ps: Participant[]) =>
      this.emit('room.active_speakers', { who: ps.map(label) })
    );
    r.on(RoomEvent.Reconnecting, () => this.emit('room.reconnecting'));
    r.on(RoomEvent.Reconnected, () => this.emit('room.reconnected'));
    r.on(RoomEvent.Disconnected, (reason: unknown) => {
      this.emit('room.disconnected', { reason: String(reason) });
      this.h.disconnected(String(reason));
    });
    await r.connect(conn.url, conn.token, {
      autoSubscribe: true,
      dynacast: false,
    });
    this.emit('room.joined', {
      room: conn.room,
      as: r.localParticipant?.identity,
    });
    for (const p of r.remoteParticipants.values()) {
      this.emit('room.participant_present', {
        who: label(p),
        name: p.name,
        kind: p.kind,
      });
      if (!human(p)) continue;
      this.h.joined(label(p), p.name || label(p));
      for (const pub of p.trackPublications.values())
        if (pub.track && pub.kind === TrackKind.KIND_AUDIO)
          this.subscribed(pub.track, pub, p);
    }
  }
  private subscribed(
    t: RemoteTrack,
    pub: RemoteTrackPublication,
    p: RemoteParticipant
  ) {
    this.emit('room.track_subscribed', {
      who: label(p),
      kind: t.kind,
      sid: pub.sid,
      source: pub.source,
      muted: pub.muted,
    });
    if (
      t.kind !== TrackKind.KIND_AUDIO ||
      !human(p) ||
      this.listening.has(pub.sid!)
    )
      return;
    this.listening.add(pub.sid!);
    void this.listen(t, pub.sid!, label(p));
  }
  private async listen(t: RemoteTrack, sid: string, who: string) {
    const stream = new AudioStream(t, {
      sampleRate: IN_RATE,
      numChannels: 1,
      frameSizeMs: 20,
    });
    let frames = 0;
    try {
      for await (const f of stream) {
        if (frames++ === 0)
          this.emit('room.first_frame', {
            who,
            sid,
            rate: f.sampleRate,
            samples: f.samplesPerChannel,
          });
        const d = f.data;
        for (let i = 0; i + IN_FRAME <= d.length; i += IN_FRAME)
          this.h.audio(who, d.slice(i, i + IN_FRAME));
      }
    } catch (e) {
      this.emit('room.stream_error', { who, sid, error: String(e) });
    } finally {
      this.listening.delete(sid);
      this.emit('room.stream_ended', { who, sid, frames });
      this.h.trackEnded?.(who);
    }
  }
  speaker(rate: number, onPlayed?: (pcm: Int16Array) => void): SourceSpeaker {
    this.source = new AudioSource(rate, 1, 200); // short queue: a duck or stop is heard at once
    return new SourceSpeaker(
      this.source,
      rate,
      (error) => {
        this.emit('room.playback_error', { error: String(error) });
        this.h.disconnected('playback_error');
      },
      onPlayed
    );
  }
  async publish(name: string) {
    if (!this.source) throw new Error('speaker() first');
    const track = LocalAudioTrack.createAudioTrack(name, this.source);
    const opts = new TrackPublishOptions();
    opts.source = TrackSource.SOURCE_MICROPHONE;
    await this.room.localParticipant!.publishTrack(track, opts);
    this.emit('room.published', { name });
  }
  humans(): string[] {
    return [...this.room.remoteParticipants.values()].filter(human).map(label);
  }
  async leave() {
    try {
      await this.room.disconnect();
    } finally {
      this.source?.close();
    }
  }
}
