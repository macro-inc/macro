import { debounce } from '@solid-primitives/scheduled';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';

export const TOOL_GROUP_REVEAL_DELAY_MS = 150;
export const TOOL_GROUP_MIN_VISIBLE_MS = 600;
export const TOOL_GROUP_COMPLETION_DELAY_MS = 150;

/** Keep fast batches compact and give visible batches time to settle. */
export function createToolGroupDisclosure(options: {
  active: Accessor<boolean>;
  defaultOpen?: boolean;
}) {
  const [expanded, setOpen] = createSignal(options.defaultOpen ?? false);
  let manuallyControlled = false;
  let minimumVisibleElapsed = true;
  let completionDelayElapsed = false;

  // The hold belongs to an opening, so a hundred calls share the same delay.
  const finishMinimumVisible = debounce(() => {
    minimumVisibleElapsed = true;
    if (completionDelayElapsed && !options.active()) setOpen(false);
  }, TOOL_GROUP_MIN_VISIBLE_MS);

  // A brief idle gap often separates sequential batches in the same run.
  const finishCompletion = debounce(() => {
    completionDelayElapsed = true;
    if (minimumVisibleElapsed && !options.active()) setOpen(false);
  }, TOOL_GROUP_COMPLETION_DELAY_MS);

  const beginMinimumVisible = () => {
    minimumVisibleElapsed = false;
    finishMinimumVisible();
  };

  const reveal = debounce(() => {
    if (!options.active()) return;
    setOpen(true);
    beginMinimumVisible();
  }, TOOL_GROUP_REVEAL_DELAY_MS);

  // Synchronize the external timers with activity; completion never waits on
  // an individual tool, and resumed work retains the original hold deadline.
  createEffect(
    on(options.active, (active, previousActive) => {
      if (manuallyControlled) return;
      reveal.clear();
      finishCompletion.clear();
      completionDelayElapsed = false;

      if (active) {
        if (!expanded()) reveal();
        else if (previousActive === undefined) beginMinimumVisible();
      } else if (previousActive !== undefined && expanded()) {
        finishCompletion();
      }
    })
  );

  const setExpanded = (open: boolean) => {
    manuallyControlled = true;
    reveal.clear();
    finishMinimumVisible.clear();
    finishCompletion.clear();
    setOpen(open);
  };

  return {
    expanded,
    setExpanded,
    toggle: () => setExpanded(!expanded()),
  };
}
