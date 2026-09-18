/** Metadata-only lifecycle contract; no recordings, transcripts, or error text. */
export type DictationOutcome =
  | 'success'
  | 'empty_transcript'
  | 'empty_audio'
  | 'microphone_error'
  | 'recording_error'
  | 'cancelled'
  | 'interrupted'
  | 'disposed';

export interface DictationTrace {
  event(
    name:
      | 'recording_started'
      | 'recording_stopped'
      | 'recording_limit'
      | 'confirmed'
      | 'upload_started'
      | 'upload_failed',
    attributes?: { audioBytes?: number; attempt?: number }
  ): void;
  /** Propagate the session context to the existing HTTP client tracing. */
  run<T>(operation: () => T): T;
  end(outcome: DictationOutcome): void;
}
