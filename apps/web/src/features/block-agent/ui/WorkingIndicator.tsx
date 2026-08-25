/**
 * The transcript's "something is happening" row: the chat block's pulsing
 * star (`ChatMessages`' stream indicator) beside a shimmering line naming
 * what the harness is doing. Shown while a wait has nothing else on screen —
 * a container booting, a sandbox resuming, a turn that hasn't streamed yet.
 */

import { PulsingStar } from '@entity/components/PulsingStar';
import { TextShimmer } from './TextShimmer';

export interface WorkingIndicatorProps {
  /** What the harness is doing, e.g. "Thinking" or "Starting container". */
  label: string;
}

export function WorkingIndicator(props: WorkingIndicatorProps) {
  return (
    <div class="flex min-h-7 items-center gap-2 py-1 text-xs leading-5 text-ink-extra-muted">
      <PulsingStar kind="streamIndicator" animate />
      <TextShimmer text={props.label} active />
    </div>
  );
}
