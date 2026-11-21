import { onElementConnect } from '@core/util/onElementConnect';
import { isPlatform } from '@core/util/platform';
import MacroBrandLoader from '@icon/macro-brand-loader-2.svg';
import { cn } from '@ui';
import { createSignal, onCleanup, onMount } from 'solid-js';

/** How often the loader moves on native Android: four steps a second. */
const ANDROID_STEP_MS = 250;

/**
 * Native Android steps loading indicators so they draw a frame only when they
 * move (see `.skeleton-shimmer` in index.css). The loader animates with SMIL,
 * which CSS cannot retime, so it is paused and advanced here instead, once in
 * the document: a detached SVG has no animation timeline to pause.
 */
function stepOnAndroid(svg: SVGSVGElement) {
  if (!isPlatform('android')) return;
  let timer: ReturnType<typeof setInterval> | undefined;
  onCleanup(() => clearInterval(timer));
  onElementConnect(svg, () => {
    svg.pauseAnimations();
    timer = setInterval(
      () => svg.setCurrentTime(svg.getCurrentTime() + ANDROID_STEP_MS / 1000),
      ANDROID_STEP_MS
    );
  });
}

export function LoadingSpinner(props: { class?: string }) {
  return (
    <div class={cn('text-accent size-48 p-14', props.class)}>
      <MacroBrandLoader class="size-full" ref={stepOnAndroid} />
    </div>
  );
}

export function LoadingPanel() {
  const [showSpinner, setShowSpinner] = createSignal(false);

  onMount(() => {
    const timeoutId = setTimeout(() => {
      setShowSpinner(true);
    }, 500);

    return () => clearTimeout(timeoutId);
  });

  return (
    <div
      class="flex flex-col size-full justify-center items-center relative font-mono"
      classList={{
        'opacity-100': showSpinner(),
        'opacity-0': !showSpinner(),
      }}
    >
      <LoadingSpinner />
    </div>
  );
}
