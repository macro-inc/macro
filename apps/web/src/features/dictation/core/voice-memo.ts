import type { VolumeLevel } from './volume';

export type VoiceMemoPhase =
  | 'unavailable'
  | 'idle'
  | 'starting'
  | 'recording'
  | 'attaching'
  /** Attaching failed; the recording is kept so it can be retried. */
  | 'failed';

/** Why the last recording ended without attaching, or a note about it. */
export type VoiceMemoNotice =
  | 'microphone_denied'
  | 'microphone_missing'
  | 'microphone_failed'
  | 'recording_failed'
  | 'empty'
  | 'limit'
  | 'upload_failed'
  | 'interrupted';

export interface VoiceMemoController {
  phase(): VoiceMemoPhase;
  /** Whether the recording panel covers the composer. */
  active(): boolean;
  volumeHistory(): readonly VolumeLevel[];
  /** Time recorded so far, or the length of the finished recording. */
  elapsedMs(): number;
  notice(): VoiceMemoNotice | undefined;
  /** Drop the notice, e.g. once the draft has moved on. */
  clearNotice(): void;
  disabled(): boolean;
  start(): Promise<void>;
  /** Finish recording and attach it; resolves once attached or abandoned. */
  stop(): Promise<void>;
  /** Attach a recording whose upload failed again. */
  retry(): Promise<void>;
  /** Discard the recording; does nothing once it is uploading. */
  cancel(): void;
}

const EXTENSIONS: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
};

/**
 * The file a recording is attached as, `name` plus the container's
 * extension. The type drops codec parameters: the static file store serves
 * it back as the Content-Type players sniff.
 */
export function voiceMemoFile(audio: Blob, name: string): File {
  const type = audio.type.split(';')[0].trim();
  const extension = EXTENSIONS[type] ?? 'webm';
  return new File([audio], `${name}.${extension}`, {
    type: type || 'audio/webm',
  });
}

/** `m:ss` for a recording length. */
export function formatRecordingTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}
