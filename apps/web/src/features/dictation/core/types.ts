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

export interface DictationController {
  phase(): DictationPhase;
  active(): boolean;
  volumeHistory(): readonly VolumeLevel[];
  message(): string;
  label(): string;
  disabled(): boolean;
  start(): Promise<void>;
  /** Resolves once the text has been committed, or the attempt was abandoned. */
  confirm(): Promise<void>;
  cancel(): void;
}
