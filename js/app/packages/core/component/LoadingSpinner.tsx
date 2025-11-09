import CropMarkCircle from '@macro-icons/macro-crop-circle.svg';
import Macro from '@macro-icons/macro-macro.svg';
import { createSignal, onMount } from 'solid-js';
import { GlitchText } from './GlitchText';
import { PcNoiseGrid } from './PcNoiseGrid';
import { Uuid7Viz } from './UuidVisualizer';

export function LoadingSpinner() {
  return (
    <div class="bg-panel text-accent size-48 relative p-2">
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
      <Macro class="text-panel size-48 inset-0 absolute p-14" />
    </div>
  );
}

export function LoadingPanel(props: { blockId: string }) {
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
      <div class="absolute bottom-2 right-2 text-ink-extra-muted">
        <CropMarkCircle />
      </div>
      <div class="absolute top-2 left-2 text-xs text-ink-extra-muted flex flex-col gap-2">
        <CropMarkCircle />
        <GlitchText from={`INIT DOCUMENT [ ${props.blockId} ]`} continuous />
        <Uuid7Viz uuid={props.blockId} mode="barcode" cell={1} />
      </div>
      <div class="absolute top-2 right-2 text-xs text-ink-extra-muted">
        <CropMarkCircle />
      </div>
      <div class="absolute bottom-2 left-2 text-xs text-ink-extra-muted">
        <CropMarkCircle />
      </div>
    </div>
  );
}
