import type { ParentProps } from 'solid-js';

/** Experimental desktop chrome for the Activity feed. */
export function ExperimentalActivityView(props: ParentProps) {
  return (
    <div class="@container/experimental-activity flex size-full min-h-0 flex-col bg-panel">
      <header class="shrink-0 px-6 pb-5 pt-4 @max-[760px]/experimental-activity:px-3 @max-[480px]/experimental-activity:px-2">
        <h1 class="m-0 text-3xl font-semibold tracking-[-0.035em] text-ink @max-[620px]/experimental-activity:text-2xl">
          Activity
        </h1>
      </header>
      <section class="min-h-0 flex-1 px-6 @max-[760px]/experimental-activity:px-3 @max-[480px]/experimental-activity:px-2">
        <div class="flex size-full min-h-0 flex-col overflow-hidden">
          {props.children}
        </div>
      </section>
    </div>
  );
}
