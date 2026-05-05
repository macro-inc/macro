import { Show } from 'solid-js';
import { type EntityData, Entity } from '@entity';
import { UserIcon } from '@core/component/UserIcon';
import type { DateValue } from '@core/util/date';

export function AttachmentEntityRow(props: {
  entity: EntityData;
  timestamp?: DateValue | null;
  senderId?: string;
  onClick?: () => void;
}) {
  return (
    <Entity.Root
      entity={props.entity}
      onClick={() => props.onClick?.()}
      class="flex items-center gap-2 min-h-10 px-2 text-sm hover:bg-hover w-full"
    >
      <div class="size-4 shrink-0">
        <Entity.Icon entity={props.entity} />
      </div>
      <span class="ph-no-capture font-semibold truncate flex-1">
        <Entity.Title entity={props.entity} />
      </span>
      <Show when={props.senderId}>
        {(id) => (
          <div class="shrink-0">
            <UserIcon id={id()} size="xs" suppressClick showTooltip />
          </div>
        )}
      </Show>
      <span class="text-xs font-mono text-ink-extra-muted uppercase font-light shrink-0">
        <Entity.Timestamp
          entity={props.entity}
          overrideTimeStamp={props.timestamp ?? undefined}
        />
      </span>
    </Entity.Root>
  );
}
