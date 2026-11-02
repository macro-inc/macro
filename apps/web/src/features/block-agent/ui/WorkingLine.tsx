/**
 * The tail of an open turn that has produced nothing to read yet.
 *
 * A sibling of `Thought`, deliberately shaped differently. This row has
 * nothing to expand, so it is not a control at all: the working dots lead,
 * and a live `Thought` keeps them in the same place so the label does not
 * shift sideways once reasoning arrives and the row becomes one.
 *
 * The label is the caller's: it says what the session is doing (`Sending`,
 * `Running tools`, `Stopping`), so it changes only when the state does.
 */

import { TextShimmer } from './TextShimmer';
import { WorkingDots } from './WorkingDots';

export interface WorkingLineProps {
  /** What the turn is doing right now. Defaults to `Working`. */
  label?: string;
}

const DEFAULT_LABEL = 'Working';

export function WorkingLine(props: WorkingLineProps) {
  const label = () => props.label ?? DEFAULT_LABEL;

  return (
    <div class="flex min-h-8 items-center gap-2 py-1 text-sm leading-6 text-ink-extra-muted">
      <WorkingDots />
      <TextShimmer text={label()} label={label()} active />
    </div>
  );
}
