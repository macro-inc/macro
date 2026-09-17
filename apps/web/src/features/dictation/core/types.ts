import type { VolumeLevel } from './volume';

// Narrow contract for the experimental, local-only Web Speech API.
export type SpeechAvailability =
  | 'available'
  | 'downloadable'
  | 'downloading'
  | 'unavailable';

export type LocalSpeechOptions = { langs: string[]; processLocally: true };

export interface LocalSpeechRecognition {
  processLocally: boolean;
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onresult:
    | ((event: {
        results: ArrayLike<{
          isFinal: boolean;
          [index: number]: { transcript: string };
        }>;
      }) => void)
    | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface LocalSpeechConstructor {
  new (): LocalSpeechRecognition;
  available(options: LocalSpeechOptions): Promise<SpeechAvailability>;
  install(options: LocalSpeechOptions): Promise<boolean>;
}

export type DictationPhase =
  | 'checking'
  | 'unavailable'
  | 'idle'
  | 'installing'
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
  transcript(): string;
  message(): string;
  label(): string;
  disabled(): boolean;
  start(): Promise<void>;
  /** Resolves once the text has been committed, or the attempt was abandoned. */
  confirm(): Promise<void>;
  cancel(): void;
}
