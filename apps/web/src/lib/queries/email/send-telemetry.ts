import { Telemetry } from '@macro-inc/observability';
import type { EmailSendAttemptFieldsFragment } from '@service-storage/graphql/generated/graphql';
import { CombinedError } from '@urql/core';
import type { EmailSendIntent } from './send-queue';

export type EmailSendObservation = {
  operation:
    | 'enqueue'
    | 'cancel'
    | 'restore'
    | 'recover'
    | 'status'
    | 'refresh';
  outcome:
    | 'started'
    | 'queued'
    | 'committed'
    | 'completed'
    | 'error'
    | 'observed';
  status?: EmailSendAttemptFieldsFragment['status'];
  durationMs?: number;
  failureKind?: 'network' | 'graphql' | 'unknown';
};

/** Classify failures without exporting error messages, response bodies, or extensions. */
export function emailSendFailureKind(
  error: unknown
): NonNullable<EmailSendObservation['failureKind']> {
  return error instanceof CombinedError
    ? error.networkError
      ? 'network'
      : 'graphql'
    : 'unknown';
}

/** Explicit fields only: never pass a request, snapshot, or raw exception to telemetry. */
export function recordEmailSend(
  observation: EmailSendObservation,
  intent?: EmailSendIntent
): void {
  try {
    const attributes = {
      'email_send.operation': observation.operation,
      'email_send.outcome': observation.outcome,
      ...(observation.failureKind
        ? { 'email_send.failure_kind': observation.failureKind }
        : {}),
      ...(observation.status
        ? { 'email_send.status': observation.status }
        : {}),
      ...(observation.durationMs !== undefined
        ? { 'email_send.duration_ms': Math.max(0, observation.durationMs) }
        : {}),
      ...(intent
        ? {
            'email_send.attempt_id': intent.uuid,
            'email_send.link_id': intent.metadata.payload.input.attempt.linkId,
            'email_send.phase': intent.phase,
            'email_send.cache_missing': !!intent.cacheMissing,
            'email_send.recovery_required': !!intent.recoveryRequired,
            'email_send.cancellation_requested': !!intent.cancellationRequested,
            'email_send.restoring': !!intent.metadata.payload.restoring,
          }
        : {}),
    };
    if (observation.outcome === 'error') {
      Telemetry.warn('email_send.lifecycle', attributes);
    } else {
      Telemetry.info('email_send.lifecycle', attributes);
    }
  } catch {
    // Exporter failures cannot change send authority or draft persistence.
  }
}
