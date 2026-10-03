import type { Span } from '@macro-inc/observability';
import { VOLUME_INTERVAL_MS, type VolumeLevel } from './volume';

/** Mirrors the server body limit for `/dictation/transcribe`. */
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
/** Leave room for codec padding below the server's five-minute limit. */
export const MAX_RECORDING_MS = 5 * 60 * 1000 - 1_000;
/** Requested chunk cadence; browsers may deliver chunks late. */
export const RECORDING_CHUNK_MS = VOLUME_INTERVAL_MS;

export type AudioRecorderCallbacks = {
  /** Microphone level for the chunk that just finished, while recording. */
  onLevel?: (level: VolumeLevel) => void;
  /** Final encoded audio, including the browser's last data event. */
  onRecording: (audio: Blob) => void;
  /** Another composer acquired the microphone; this session was discarded. */
  onInterrupted: () => void;
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
  signal: AbortSignal,
  trace?: Pick<Span, 'run' | 'event'>
) => Promise<string>;
