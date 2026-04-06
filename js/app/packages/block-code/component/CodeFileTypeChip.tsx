import { blockMetadataSignal } from '@core/signal/load';
import { Show } from 'solid-js';

export function CodeFileTypeChip() {
  const fileType = () => blockMetadataSignal()?.fileType;

  return (
    <Show when={fileType()}>
      <span class="shrink-0 rounded px-1 py-0.5 text-[0.625rem] font-mono font-medium uppercase leading-none bg-code-bg text-code">
        {fileType()}
      </span>
    </Show>
  );
}
