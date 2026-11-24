import type { ActivityRow } from '@service-agent-fold/generated/types';

/**
 * The labels the session fold gives a code-mode program that ended without
 * naming a step. A copy of `FAILED` and `INTERRUPTED` in
 * `crates/folds/agent_fold/src/domain/model/segment/code_execution.rs`
 * (`UNNAMED_STEP_LABELS`): the fold exports neither them nor a structural
 * flag, and a posted reply's snapshot rows carry only the label.
 */
export const UNNAMED_OUTCOME_LABELS = {
  failed: 'A step failed',
  interrupted: 'Step interrupted',
} as const;

/**
 * A row that only says a program failed or was cut off. A reply leaves it
 * out: the agent explains a failure in its own words.
 */
export function isUnnamedOutcome(
  row: Pick<ActivityRow, 'label' | 'status'>
): boolean {
  return (
    (row.status === 'failed' && row.label === UNNAMED_OUTCOME_LABELS.failed) ||
    (row.status === 'interrupted' &&
      row.label === UNNAMED_OUTCOME_LABELS.interrupted)
  );
}
