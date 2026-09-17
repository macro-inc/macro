import { VOLUME_INTERVAL_MS, type VolumeLevel } from './volume';

/** Mirrors the server body limit for `/dictation/transcribe`. */
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
export const MAX_RECORDING_MS = 5 * 60 * 1000;
/**
 * Recorder timeslice. Every chunk yields one volume sample and advances the
 * duration cap, so limits and the timeline share one event-driven clock.
 */
export const RECORDING_CHUNK_MS = VOLUME_INTERVAL_MS;
export const MAX_RECORDING_CHUNKS = MAX_RECORDING_MS / RECORDING_CHUNK_MS;

export type AudioRecorderCallbacks = {
  /** Microphone level for the chunk that just finished, while recording. */
  onLevel?: (level: VolumeLevel) => void;
  /**
   * Final encoded audio after `stop()`. Omit to run as a microphone meter
   * only: chunks are dropped instead of retained.
   */
  onRecording?: (audio: Blob) => void;
  /** The size or duration cap was reached; the recorder stopped itself. */
  onLimit?: () => void;
  /** Capture failed after it had started. The microphone is already released. */
  onError: (error: Error) => void;
};

/** What the primitives need from a recorder; `AudioRecorder` is the browser one. */
export interface RecorderHandle {
  /** Acquire the microphone and begin capturing. Rejects on permission failure. */
  start(): Promise<void>;
  /** Finish capturing; `onRecording` receives the audio. */
  stop(): void;
  /** Discard everything and release the microphone. */
  cancel(): void;
}

export type CreateRecorder = (
  callbacks: AudioRecorderCallbacks
) => RecorderHandle;

export type TranscribeAudio = (
  audio: Blob,
  signal: AbortSignal
) => Promise<string>;
