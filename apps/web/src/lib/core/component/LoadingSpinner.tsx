import { pauseOffscreenAnimations } from '@core/util/animationVisibility';
import MacroBrandLoader from '@icon/macro-brand-loader-2.svg';
import { cn } from '@ui';
import { createSignal, onCleanup, onMount } from 'solid-js';

export function LoadingSpinner(props: { class?: string }) {
  return (
    <div class={cn('text-accent size-48 p-14', props.class)}>
      <MacroBrandLoader ref={pauseOffscreenAnimations} class="size-full" />
    </div>
  );
}

export function LoadingPanel() {
  const [showSpinner, setShowSpinner] = createSignal(false);

  onMount(() => {
    const timeoutId = setTimeout(() => {
      setShowSpinner(true);
    }, 500);

    onCleanup(() => clearTimeout(timeoutId));
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
