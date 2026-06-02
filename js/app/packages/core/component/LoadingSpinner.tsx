import MacroBrandLoader from '@icon/macro-brand-loader-2.svg';
import { createSignal, onMount } from 'solid-js';

export function LoadingSpinner() {
  return (
    <div class="text-accent size-48 p-14">
      <MacroBrandLoader class="size-full" />
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
