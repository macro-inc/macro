import type { Span } from '@macro-inc/observability';
import type { VolumeLevel } from './volume';

/** Mirrors the server body limit for `/dictation/transcribe`. */
export const MAX_RECORDING_BYTES = 8 * 1024 * 1024;
/** Leave room for codec padding below the server's five-minute limit. */
export const MAX_RECORDING_MS = 5 * 60 * 1000 - 1_000;
/** Requested chunk cadence; browsers may deliver chunks late. */
export const RECORDING_CHUNK_MS = 200;

/** Containers a recorder tries, most preferred first. */
export type RecordingFormats = readonly string[];

/** Transcription accepts any of these, so the smallest encoder wins. */
export const DICTATION_FORMATS: RecordingFormats = [
  'audio/webm;codecs=opus',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/**
 * Voice memos are played back by every recipient, so AAC in MP4 comes first:
 * Safari, iOS and Chrome record it, and every supported browser plays it.
 * Firefox records only WebM/Ogg Opus, which Chrome, Firefox and Safari 17+ play.
 */
export const VOICE_MEMO_FORMATS: RecordingFormats = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
];

export type AudioRecorderCallbacks = {
  /** Microphone level, sampled every `VOLUME_INTERVAL_MS` while recording. */
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
