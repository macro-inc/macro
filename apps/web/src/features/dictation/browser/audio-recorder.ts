import { createAmplitudeFromStream } from '@solid-primitives/stream';
import { createRoot } from 'solid-js';
import {
  type AudioRecorderCallbacks,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_MS,
  RECORDING_CHUNK_MS,
  type RecorderHandle,
} from '../core/recording';

const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];
const AUDIO_BITS_PER_SECOND = 64_000;
/** Stop early enough that the final chunk still fits under the server limit. */
const SIZE_HEADROOM_BYTES = 64 * 1024;

/** A monotonic clock and cancellable deadline, supplied explicitly in tests. */
export interface RecordingClock {
  now(): number;
  schedule(callback: () => void, delay: number): () => void;
}

const browserClock: RecordingClock = {
  now: () => performance.now(),
  schedule: (callback, delay) => {
    const timeout = window.setTimeout(callback, delay);
    return () => window.clearTimeout(timeout);
  },
};

type State = 'idle' | 'starting' | 'recording' | 'stopping' | 'done';

const stopTracks = (stream: MediaStream) =>
  stream.getTracks().forEach((track) => track.stop());

/**
 * One capture session, initialized with the callbacks receiving its audio.
 * Owns microphone tracks, the encoder, analyser, and deadline until released.
 */
export class AudioRecorder implements RecorderHandle {
  private state: State = 'idle';
  private stream: MediaStream | undefined;
  private recorder: MediaRecorder | undefined;
  private releaseMeter: (() => void) | undefined;
  private cancelDeadline: (() => void) | undefined;
  private chunks: Blob[] = [];
  private size = 0;
  private startedAt = 0;

  constructor(
    private readonly callbacks: AudioRecorderCallbacks,
    private readonly owner: AudioRecorderManager = audioRecorder,
    private readonly clock: RecordingClock = browserClock
  ) {}

  static isSupported(): boolean {
    return !!(
      typeof window !== 'undefined' &&
      window.isSecureContext &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof MediaRecorder !== 'undefined' &&
      MIME_TYPES.some((type) => MediaRecorder.isTypeSupported(type))
    );
  }

  /** Whether this instance currently owns the microphone. */
  get recording(): boolean {
    return this.state === 'recording' || this.state === 'stopping';
  }

  async start(): Promise<void> {
    if (this.state !== 'idle') return;
    this.owner.claim(this);
    this.state = 'starting';
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      this.release();
      throw error;
    }
    // Cancelled while the permission prompt was open: the grant arrives late.
    if (this.state !== 'starting') {
      stopTracks(stream);
      return;
    }
    this.stream = stream;
    try {
      const mimeType = MIME_TYPES.find((type) =>
        MediaRecorder.isTypeSupported(type)
      );
      if (!mimeType) throw new Error('No supported recording format');
      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
      });
      const readLevel = this.startMeter(stream);
      recorder.ondataavailable = ({ data }) => this.onChunk(data, readLevel());
      recorder.onerror = () =>
        this.fail(new Error('Audio recording failed. Please try again.'));
      recorder.onstop = () => this.onStop();
      this.recorder = recorder;
      this.startedAt = this.clock.now();
      this.state = 'recording';
      recorder.start(RECORDING_CHUNK_MS);
      this.cancelDeadline = this.clock.schedule(
        () => this.stopAtLimit(),
        MAX_RECORDING_MS
      );
    } catch (error) {
      this.release();
      throw error;
    }
  }

  stop(): void {
    if (this.state !== 'recording' || !this.recorder) return;
    this.state = 'stopping';
    if (this.recorder.state !== 'inactive') this.recorder.stop();
  }

  cancel(): void {
    if (this.state === 'done') return;
    const recorder = this.recorder;
    this.release();
    // A stop issued after release is ignored by onStop: state is already done.
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  /** Release ownership without moving focus away from the next composer. */
  interrupt(): void {
    if (this.state === 'done') return;
    this.cancel();
    this.callbacks.onInterrupted();
  }

  private startMeter(stream: MediaStream): () => number {
    let amplitude = () => 0;
    this.releaseMeter = createRoot((dispose) => {
      // Library level is 0..100; the analyser is never routed to speakers.
      const [level] = createAmplitudeFromStream(stream);
      amplitude = level;
      return dispose;
    });
    return () => amplitude() / 100;
  }

  private stopAtLimit() {
    if (this.state !== 'recording') return;
    this.callbacks.onLimit?.();
    this.stop();
  }

  private onChunk(data: Blob, level: number) {
    if (!this.recording) return;
    // Delayed/final chunks can exceed the headroom; never retain or upload them.
    if (this.size + data.size > MAX_RECORDING_BYTES) {
      this.fail(
        new Error('Recording is too large. Please record a shorter message.')
      );
      return;
    }
    if (data.size) this.chunks.push(data);
    this.size += data.size;
    if (this.state !== 'recording') return;
    this.callbacks.onLevel?.(level);
    if (
      this.clock.now() - this.startedAt >= MAX_RECORDING_MS ||
      this.size >= MAX_RECORDING_BYTES - SIZE_HEADROOM_BYTES
    ) {
      this.stopAtLimit();
    }
  }

  private onStop() {
    // Device disconnection also delivers final data followed by a stop event.
    if (!this.recording) return;
    const audio = new Blob(this.chunks, { type: this.recorder?.mimeType });
    const { onRecording } = this.callbacks;
    this.release();
    onRecording(audio);
  }

  private fail(error: Error) {
    if (!this.recording) return;
    this.cancel();
    this.callbacks.onError(error);
  }

  private release() {
    this.state = 'done';
    this.chunks = [];
    this.size = 0;
    this.cancelDeadline?.();
    this.cancelDeadline = undefined;
    if (this.recorder) {
      this.recorder.ondataavailable = null;
      this.recorder.onerror = null;
      this.recorder.onstop = null;
      this.recorder = undefined;
    }
    this.releaseMeter?.();
    this.releaseMeter = undefined;
    if (this.stream) stopTracks(this.stream);
    this.stream = undefined;
    this.owner.release(this);
  }
}

/** Shared microphone ownership; callbacks and captured bytes stay session-local. */
export class AudioRecorderManager {
  private active: AudioRecorder | undefined;

  constructor(private readonly clock: RecordingClock = browserClock) {}

  createSession(callbacks: AudioRecorderCallbacks): AudioRecorder {
    return new AudioRecorder(callbacks, this, this.clock);
  }

  claim(session: AudioRecorder) {
    this.active?.interrupt();
    this.active = session;
  }

  release(session: AudioRecorder) {
    if (this.active === session) this.active = undefined;
  }
}

/** App singleton. Browser resources are acquired only when a session starts. */
export const audioRecorder = new AudioRecorderManager();
