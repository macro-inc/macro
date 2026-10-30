import { PipedreamConnectorIcon } from '@core/pipedream/ConnectorIcon';
import type { SlashMenuMcp } from '@queries/slash-menu-mcps';
import { cn } from '@ui';
import { createEffect } from 'solid-js';

export function McpRow(props: {
  item: SlashMenuMcp;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}) {
  let ref: HTMLDivElement | undefined;
  createEffect(() => {
    if (props.selected) ref?.scrollIntoView({ block: 'nearest' });
  });
  return (
    <div
      ref={ref}
      class={cn(
        'group flex items-center touch:min-h-[44px] p-1.5 mx-1.5 rounded-md',
        {
          'bg-ink/5': props.selected,
        }
      )}
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={props.onHover}
      onClick={(event) => {
        event.stopPropagation();
        props.onSelect();
      }}
    >
      <div class="mr-2 flex items-center">
        <PipedreamConnectorIcon
          appSlug={props.item.appSlug ?? ''}
          class="size-4 shrink-0 text-ink-muted"
        />
      </div>
      <span
        class="min-w-0 max-w-full overflow-hidden text-nowrap text-ink text-xs sm:text-sm font-medium"
        style={{ 'text-overflow': 'ellipsis' }}
        title={props.item.name}
      >
        {props.item.name}
      </span>
    </div>
  );
}
