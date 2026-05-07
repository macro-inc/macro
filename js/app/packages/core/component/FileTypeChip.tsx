import { useBlockAliasedName } from '@core/block';
import { blockMetadataSignal } from '@core/signal/load';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { ENTITY_ICON_CONFIGS, type EntityWithValidIcon } from './EntityIcon';

export function FileTypeChip() {
  const fileType = () => blockMetadataSignal()?.fileType;
  const blockName = useBlockAliasedName();
  const config = () =>
    ENTITY_ICON_CONFIGS[blockName as EntityWithValidIcon] ??
    ENTITY_ICON_CONFIGS.default;

  return (
    <Show when={fileType()}>
      <span
        class={cn(
          'shrink-0 rounded px-1 py-0.5 text-xxs font-mono font-medium uppercase leading-none',
          config().background,
          config().foreground
        )}
      >
        {fileType()}
      </span>
    </Show>
  );
}
