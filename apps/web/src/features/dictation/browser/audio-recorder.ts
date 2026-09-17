import { createAmplitudeFromStream } from '@solid-primitives/stream';
import { createRoot } from 'solid-js';
import {
  type AudioRecorderCallbacks,
  MAX_RECORDING_BYTES,
  MAX_RECORDING_CHUNKS,
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

type State = 'idle' | 'starting' | 'recording' | 'stopping' | 'done';

const stopTracks = (stream: MediaStream) =>
  stream.getTracks().forEach((track) => track.stop());

/**
 * Captures microphone audio in memory and meters its level.
 *
 * Wraps `getUserMedia`, `MediaRecorder`, and the Web Audio analyser (via
 * `@solid-primitives/stream`) behind one object constructed with the callbacks
 * that receive levels, the finished recording, and failures. The recorder's
 * chunk cadence is the only clock: each chunk emits one level sample and
 * advances the duration cap, so nothing here depends on timers.
 *
 * Only one instance holds the microphone at a time. Starting a recorder
 * cancels whichever one is currently active, so a composer that unmounts
 * mid-recording can never leave the microphone open.
 */
export class AudioRecorder implements RecorderHandle {
  private static active: AudioRecorder | undefined;

  private state: State = 'idle';
  private stream: MediaStream | undefined;
  private recorder: MediaRecorder | undefined;
  private releaseMeter: (() => void) | undefined;
  private chunks: Blob[] = [];
  private size = 0;
  private chunkCount = 0;

  constructor(private readonly callbacks: AudioRecorderCallbacks) {}

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
    AudioRecorder.active?.cancel();
    AudioRecorder.active = this;
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
      recorder.start(RECORDING_CHUNK_MS);
      this.recorder = recorder;
      this.state = 'recording';
    } catch (error) {
      this.release();
      throw error;
    }
  }

  stop(): void {
    if (this.state !== 'recording' || !this.recorder) return;
    this.state = 'stopping';
    this.recorder.stop();
  }

  cancel(): void {
    if (this.state === 'done') return;
    const recorder = this.recorder;
    this.release();
    // A stop issued after release is ignored by onStop: state is already done.
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }

  private startMeter(stream: MediaStream): () => number {
    let amplitude = () => 0;
    this.releaseMeter = createRoot((dispose) => {
      // Library level is 0..100; the analyser is never routed to speakers.
      const [level, stopAmplitude] = createAmplitudeFromStream(stream);
      amplitude = level;
      return () => {
        stopAmplitude();
        dispose();
      };
    });
    return () => amplitude() / 100;
  }

  private onChunk(data: Blob, level: number) {
    if (!this.recording) return;
    if (this.callbacks.onRecording && data.size) {
      this.chunks.push(data);
      this.size += data.size;
    }
    this.chunkCount += 1;
    if (this.state !== 'recording') return;
    this.callbacks.onLevel?.(level);
    if (
      this.chunkCount >= MAX_RECORDING_CHUNKS ||
      this.size >= MAX_RECORDING_BYTES - SIZE_HEADROOM_BYTES
    ) {
      this.callbacks.onLimit?.();
      this.stop();
    }
  }

  private onStop() {
    if (this.state !== 'stopping') return;
    const audio = new Blob(this.chunks, { type: this.recorder?.mimeType });
    const { onRecording } = this.callbacks;
    this.release();
    onRecording?.(audio);
  }

  private fail(error: Error) {
    if (!this.recording) return;
    this.release();
    this.callbacks.onError(error);
  }

  private release() {
    this.state = 'done';
    this.chunks = [];
    this.size = 0;
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
    if (AudioRecorder.active === this) AudioRecorder.active = undefined;
  }
}
