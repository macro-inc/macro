import type { InputFailure } from '../core/failure';
import type { Field, Intent } from '../core/input';

/** Where a draft is being written; every observation is attributed to one. */
export type InputSurface = 'command-menu' | 'mobile-search' | 'channel';
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

/**
 * An uninvited guess offered beside a host's own input, before any Universal
 * Input draft exists. Whether an offer is taken is the only measure of whether
 * it was worth interrupting for.
 */
export type SuggestionObservation =
  | { event: 'offered'; intent: Intent; score: number }
  | {
      event: 'retired';
      intent: Intent;
      outcome: 'accepted' | 'dismissed' | 'replaced' | 'abandoned';
    };
