/**
 * What the checker finds on main today, each with the defect that causes it.
 * A fix removes its entries: the checker fails on a violation that is not
 * listed, and on a listed one it no longer finds.
 */
import type { ViolationKey } from './explore';
import type { InjectedFault } from './world';

export type KnownViolation = ViolationKey & {
  /** The defect that causes it. */
  cause: string;
  /** Found only by the deep scenarios. */
  deep?: boolean;
};

const WIPE =
  'The open after an engine died in a live page wipes the database, queued writes included.';

const known = (
  cause: string,
  faults: InjectedFault[],
  symptoms: string[],
  rest: { reordered?: boolean; deep?: boolean } = {}
): KnownViolation[] =>
  symptoms.map((symptom) => ({
    symptom,
    faults: [...faults].sort(),
    reordered: rest.reordered ?? false,
    cause,
    ...(rest.deep ? { deep: true } : {}),
  }));

const WIPED = 'S3:queued write lost (database wiped)';

export const KNOWN_VIOLATIONS: KnownViolation[] = [
  ...known(WIPE, ['crash-engine owner'], [WIPED]),
  ...known(WIPE, ['require-reset owner'], [WIPED]),
];
