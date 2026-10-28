import type { InputFailure } from '../core/failure';
import type { Field, Intent } from '../core/input';

/** Where a draft was composed, recorded on every span the draft produces. */
export type InputSurface = 'command-menu' | 'mobile-search' | 'selection';
export type InputPhase = 'classify' | 'extract';
export type InputOperation = 'submit' | 'save-email-draft';
export type QueueObservation =
  | { action: 'requested' }
  | { action: 'started'; waitMs: number; coalesced: number }
  | { action: 'cleared'; count: number };

/** Explicit metadata only: no text, field values, names, addresses or error messages. */
export type InputObservation = { draftId: string } & (
  | {
      event: 'changed';
      revision: number;
      length: number;
      reason: 'text' | 'type' | 'field';
      intent?: Intent;
    }
  | { event: 'queue'; phase: InputPhase; observation: QueueObservation }
  | {
      event: 'prediction';
      phase: InputPhase;
      revision: number;
      intent?: Intent;
      outcome: 'started' | 'applied' | 'discarded' | 'error';
      failure?: InputFailure;
    }
  | { event: 'type'; previous?: Intent; intent?: Intent; manual: boolean }
  | { event: 'field'; intent: Intent; field: Field; inferred: boolean }
  | { event: 'ready'; revision: number; intent: Intent; valid: boolean }
  | {
      event: 'blocked';
      operation: InputOperation;
      reason: 'empty' | 'pending' | 'sending' | 'validation';
    }
  | {
      event: 'submission';
      operation: InputOperation;
      intent: Intent;
      outcome: 'started' | 'success' | 'error';
      failure?: InputFailure;
    }
  | {
      event: 'finished';
      outcome: 'submitted' | 'saved' | 'cleared' | 'abandoned';
    }
);
