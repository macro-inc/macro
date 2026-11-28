/**
 * What the checker finds on main today, each with the defect that causes it,
 * or the bound a design accepts.
 * A fix removes its entries: the checker fails on a violation that is not
 * listed, and on a listed one it no longer finds.
 */
import type { ViolationKey } from './explore';

export type KnownViolation = ViolationKey & {
  /** The defect that causes it. */
  cause: string;
  /** Found only by the deep scenarios. */
  deep?: boolean;
};

export const KNOWN_VIOLATIONS: KnownViolation[] = [
  {
    symptom: 'S8:answered head still queued (unsettled)',
    faults: ['freeze', 'hide', 'open-newer', 'thaw'],
    reordered: false,
    cause:
      'A tab frozen while its head is on the way to the server settles it only ' +
      'after SETTLEMENT_WAIT_MS, when the newer build has the database; or, ' +
      'elected to keep an engine for the head with every tab hidden, opens ' +
      'none, and a newer build opening before another tab tries takes the ' +
      'free lock. Either way the head stays queued and is sent again, at ' +
      'least once as for a lost page.',
  },
  {
    symptom: 'S8:answered head still queued (unsettled)',
    faults: ['crash-engine owner', 'open-newer'],
    reordered: false,
    cause:
      "Until the coordinator sees that the owner's engine is gone, the lock is " +
      'free, and a newer build opening then takes the database without asking. ' +
      'The old build cannot settle the head it had out, so it is sent again.',
  },
];
