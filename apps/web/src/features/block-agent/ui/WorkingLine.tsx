/**
 * The tail of an open turn that has produced nothing to read yet.
 *
 * A sibling of `Thought`, deliberately shaped differently. A thought row leads
 * with a caret because there is text behind it; this row has nothing to
 * expand, so the caret gives way to a dot that breathes on the shimmer's own
 * period, and the row is not a control at all. The leading slot keeps the
 * caret's width so the label does not shift sideways once reasoning arrives
 * and the row becomes a `Thought`.
 */

import { TextShimmer } from './TextShimmer';
import { WORKING_LABEL } from './working-verbs';

export function WorkingLine() {
  return (
    <div
      class="flex min-h-7 items-center gap-1 py-1 text-xs leading-5 text-ink-extra-muted"
      data-agent-working-line
    >
      <span
        aria-hidden="true"
        class="flex size-4 shrink-0 items-center justify-center"
      >
        <span class="agent-working-dot size-[5px] rounded-full bg-current" />
      </span>
      <TextShimmer text={WORKING_LABEL} active />
    </div>
  );
}
