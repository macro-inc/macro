import { createElementSize } from '@solid-primitives/resize-observer';
import { createEffect, createSignal, Index, on, onCleanup } from 'solid-js';
import { VOLUME_INTERVAL_MS } from '../core/volume';

export function VolumeTimeline(props: { levels: readonly number[] }) {
  const [container, setContainer] = createSignal<HTMLDivElement>();
  const size = createElementSize(container);
  let strip!: HTMLDivElement;
  // One extra bar enters from beyond the right edge while the strip slides.
  const visibleLevels = () => {
    const count = Math.ceil((size.width ?? 0) / 6) + 1;
    const levels = props.levels.slice(-count);
    return [
      ...Array<number>(Math.max(0, count - levels.length)).fill(0),
      ...levels,
    ];
  };

  createEffect(
    on(
      () => props.levels,
      (levels) => {
        if (
          !levels.length ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
        )
          return;
        const animation = strip.animate?.(
          [{ transform: 'translateX(6px)' }, { transform: 'translateX(0)' }],
          { duration: VOLUME_INTERVAL_MS, easing: 'linear' }
        );
        onCleanup(() => animation?.cancel());
      },
      { defer: true }
    )
  );

  return (
    <div
      ref={setContainer}
      aria-hidden="true"
      class="relative h-8 min-w-0 flex-1 overflow-hidden"
    >
      <div
        ref={strip}
        class="absolute inset-y-0 right-0 flex w-max items-center gap-[3px]"
      >
        <Index each={visibleLevels()}>
          {(level) => (
            <span
              class="w-[3px] shrink-0 rounded-full bg-current"
              style={{
                height: `${3 + level() * 29}px`,
                opacity: level() > 0 ? '0.65' : '0.3',
              }}
            />
          )}
        </Index>
      </div>
    </div>
  );
}
