import {
  type BlockAlias,
  type BlockName,
  useBlockAliasedName,
} from '@core/block';
import { blockMetadataSignal } from '@core/signal/load';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { ENTITY_ICON_CONFIGS, type EntityWithValidIcon } from './EntityIcon';

/** A file's type, tinted like its entity icon. Block-free. */
export function FileTypeLabel(props: {
  fileType: string | null | undefined;
  entityKind: BlockName | BlockAlias;
}) {
  const config = () =>
    ENTITY_ICON_CONFIGS[props.entityKind as EntityWithValidIcon] ??
    ENTITY_ICON_CONFIGS.default;

  return (
    <Show when={props.fileType}>
      <span
        class={cn(
          'shrink-0 rounded px-1 py-0.5 text-xxs font-mono font-medium uppercase leading-none',
          config().background,
          config().foreground
        )}
      >
        {props.fileType}
      </span>
    </Show>
  );
}

/** Reads the file type and kind from the enclosing legacy Block. */
export function FileTypeChip() {
  const blockName = useBlockAliasedName();
  return (
    <FileTypeLabel
      fileType={blockMetadataSignal()?.fileType}
      entityKind={blockName}
    />
  );
}
