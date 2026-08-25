import { ComposedSplitControls } from '@components/app/split-layout/composed/ComposedSplitControls';
import { ComposedSplitHeader } from '@components/app/split-layout/composed/ComposedSplitHeader';
import type { ParentProps } from 'solid-js';

/** Experimental desktop chrome for the Activity feed. */
export function ExperimentalActivityView(props: ParentProps) {
  return (
    <div class="@container/experimental-activity flex size-full min-h-0 flex-col bg-panel">
      <ComposedSplitHeader class="flex shrink-0 items-center gap-3 border-b border-edge px-6 pb-4 pt-2 @max-[760px]/experimental-activity:px-3 @max-[480px]/experimental-activity:px-2">
        <ComposedSplitControls />
        <h1 class="m-0 text-2xl font-semibold tracking-[-0.035em] text-ink">
          Activity
        </h1>
      </ComposedSplitHeader>
      <section class="min-h-0 flex-1 px-6 @max-[760px]/experimental-activity:px-3 @max-[480px]/experimental-activity:px-2">
        <div class="flex size-full min-h-0 flex-col overflow-hidden">
          {props.children}
        </div>
      </section>
    </div>
  );
}
