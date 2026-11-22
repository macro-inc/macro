import type { ExecutorSettlement } from '@macro-inc/collaboration/session/executor';

/** An opaque error holder preserves even a thrown undefined without changing it. */
export interface InputCommitFailure {
  readonly error: unknown;
}

export type InputCommitCancellation = Extract<
  ExecutorSettlement,
  { status: 'cancelled' }
>['reason'];

/** Closed result copied from the exact native main transaction, not view mutations. */
export type DatabaseCommitEvidence =
  | { readonly kind: 'started'; readonly key: number; readonly awaitId: string }
  | {
      readonly kind:
        | 'none'
        | 'inserted'
        | 'not-await'
        | 'removed'
        | 'absent'
        | 'invalid';
    };

/** Copied entry evidence, independent of attachment, durability or permission. */
export type InputCommitEvidence =
  | {
      readonly status: 'not-entered';
      readonly cause:
        | { readonly status: 'error'; readonly error: unknown }
        | {
            readonly status: 'cancelled';
            readonly reason: InputCommitCancellation;
          };
    }
  | { readonly status: 'not-published'; readonly entryId: bigint }
  | {
      readonly status: 'published';
      readonly entryId: bigint;
      readonly commitId: bigint;
      readonly mainHandled: boolean;
      readonly database?: DatabaseCommitEvidence;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'unsupported-profile' | 'correlation-exhausted';
      readonly receiverNeverCalled: true;
    }
  | {
      readonly status: 'unavailable';
      readonly receiverNeverCalled: false;
      readonly reason: 'receipt-read' | 'receipt-shape';
      readonly failure?: InputCommitFailure;
    };

export type InputCommitObservationState =
  | { readonly status: 'unbound' }
  | { readonly status: 'pending' }
  | InputCommitEvidence;

/** One use; read is pure JS and returns the same object until a transition. */
export interface InputCommitObservation {
  read(): InputCommitObservationState;
}

/** No observed native entry is attempted for this explicit capability refusal. */
export class InputCommitUnavailableError extends Error {
  constructor(
    readonly evidence: Extract<
      InputCommitEvidence,
      { receiverNeverCalled: true }
    >
  ) {
    super(`Input commit observation unavailable: ${evidence.reason}`);
    this.name = 'InputCommitUnavailableError';
  }
}

interface ObservationRecord {
  state: InputCommitObservationState;
  notify: ((evidence: InputCommitEvidence) => void) | undefined;
}
const observations = new WeakMap<InputCommitObservation, ObservationRecord>();

/** The listener is synchronous only; asynchronous continuations have no fence. */
export function createInputCommitObservation(
  notify?: (evidence: InputCommitEvidence) => void
): InputCommitObservation {
  if (notify !== undefined && typeof notify !== 'function')
    throw new TypeError(
      'Input commit observation requires a listener function'
    );
  const record: ObservationRecord = {
    state: Object.freeze({ status: 'unbound' }),
    notify,
  };
  const observation = Object.freeze({ read: () => record.state });
  observations.set(observation, record);
  return observation;
}

/** Port-internal transition authority, never native or model authority. */
export function claimInputCommitObservation(
  observation: InputCommitObservation
) {
  const record = observations.get(observation);
  if (!record) throw new TypeError('Unknown input commit observation');
  if (record.state.status !== 'unbound')
    throw new Error('Input commit observation already claimed');
  // Claim before enqueue, which can execute and reenter synchronously.
  record.state = Object.freeze({ status: 'pending' });
  return {
    pending(): boolean {
      return record.state.status === 'pending';
    },
    finish(evidence: InputCommitEvidence): (() => void) | undefined {
      if (record.state.status !== 'pending')
        throw new Error('Input commit observation already completed');
      if (evidence.status === 'not-entered') Object.freeze(evidence.cause);
      if (
        evidence.status === 'unavailable' &&
        'failure' in evidence &&
        evidence.failure
      )
        Object.freeze(evidence.failure);
      const copied = Object.freeze(evidence);
      record.state = copied;
      const notify = record.notify;
      record.notify = undefined;
      if (!notify) return undefined;
      let notified = false;
      return () => {
        if (notified) throw new Error('Input commit listener already notified');
        notified = true;
        const returned: unknown = notify(copied);
        if (returned !== undefined)
          throw new TypeError(
            'Input commit listeners must return undefined synchronously'
          );
      };
    },
  };
}
