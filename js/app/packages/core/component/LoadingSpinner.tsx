import Macro from '@macro-icons/macro-logo.svg';
import { createSignal, onMount } from 'solid-js';
import { PcNoiseGrid } from './PcNoiseGrid';

export function LoadingSpinner() {
  return (
    <div class="bg-surface text-accent size-48 relative p-2">
      <PcNoiseGrid
        cellSize={12}
        warp={1}
        crunch={0.3}
        size={[0.0, 0.8]}
        rounding={100}
        freq={0.003}
        speed={[0.3, 0]}
        circleMask={0.4}
      />
      <Macro class="text-surface size-48 inset-0 absolute p-14" />
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
