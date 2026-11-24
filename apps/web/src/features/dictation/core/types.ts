import type { VolumeLevel } from './volume';

export type DictationPhase =
  | 'unavailable'
  | 'idle'
  | 'starting'
  | 'listening'
  | 'finishing'
  | 'review';

export const ACTIVE_PHASES: readonly DictationPhase[] = [
  'starting',
  'listening',
  'finishing',
  'review',
];

/** Whether `message()` reports a failure or is a plain note. */
export type DictationMessageTone = 'info' | 'error';

/** How long a note under the composer stays before it clears itself. */
export const FEEDBACK_MS = 8_000;

export interface DictationController {
  phase(): DictationPhase;
  active(): boolean;
  volumeHistory(): readonly VolumeLevel[];
  /** Time recorded so far, or the length of the finished recording. */
  elapsedMs(): number;
  /** The recording stopped at the length or size cap. */
  limitReached(): boolean;
  message(): string;
  messageTone(): DictationMessageTone;
  /** Drop the note, e.g. once the draft has moved on. */
  clearMessage(): void;
  label(): string;
  disabled(): boolean;
  start(): Promise<void>;
  /** Resolves once the text has been committed, or the attempt was abandoned. */
  confirm(): Promise<void>;
  cancel(): void;
}
