import type {
  BrainAttempt,
  EffectReceipt,
} from '../starter-agent/behavior/brain/contracts.ts';

export const createParentFixture = (
  owner: BrainAttempt,
  stop: AbortSignal,
  runFake: (signal: AbortSignal | undefined) => Promise<string>
) => {
  const receipts: EffectReceipt[] = [];
  const dispatch = async (
    attempt: BrainAttempt,
    record: string,
    signal: AbortSignal | undefined
  ) => {
    if (
      stop.aborted ||
      attempt.jobId !== owner.jobId ||
      attempt.attemptId !== owner.attemptId ||
      attempt.leaseEpoch !== owner.leaseEpoch
    )
      throw new Error('stale attempt');

    if (record !== 'fixture') throw new Error('outside fixture grant');
    if (receipts.length) throw new Error('fixture action already dispatched');

    const actionId = 'read-fixture-record';
    receipts.push({ attempt, actionId, status: 'unknown_outcome' });

    const text = await runFake(signal);
    stop.throwIfAborted();
    signal?.throwIfAborted();

    receipts[0] = {
      attempt,
      actionId,
      status: 'committed',
      externalRef: record,
    };
    return text;
  };

  return { dispatch, receipts };
};
