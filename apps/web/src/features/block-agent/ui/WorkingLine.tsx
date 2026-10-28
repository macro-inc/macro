/**
 * The tail of an open turn that has produced nothing to read yet.
 *
 * A sibling of `Thought`, deliberately shaped differently. A thought row leads
 * with a caret because there is text behind it; this row has nothing to
 * expand, so the caret gives way to three dots that ripple on the shimmer's
 * own period, and the row is not a control at all. The leading slot keeps the
 * caret's width so the label does not shift sideways once reasoning arrives
 * and the row becomes a `Thought`.
 *
 * The label is the caller's: it says what the session is doing (`Sending`,
 * `Running tools`, `Stopping`), so it changes only when the state does.
 */

import { TextShimmer } from './TextShimmer';

export interface WorkingLineProps {
  /** What the turn is doing right now. Defaults to `Working`. */
  label?: string;
}

const DEFAULT_LABEL = 'Working';

export function WorkingLine(props: WorkingLineProps) {
  const label = () => props.label ?? DEFAULT_LABEL;

  return (
    <div class="flex min-h-7 items-center gap-1 py-1 text-xs leading-5 text-ink-extra-muted">
      <span
        aria-hidden="true"
        class="agent-working-wave flex size-4 shrink-0 items-center justify-center gap-[2px]"
      >
        <span class="size-[3px] rounded-full bg-current" />
        <span class="size-[3px] rounded-full bg-current" />
        <span class="size-[3px] rounded-full bg-current" />
      </span>
      <TextShimmer text={label()} label={label()} active />
    </div>
  );
}
