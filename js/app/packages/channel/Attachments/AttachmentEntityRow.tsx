import { UserIcon } from '@core/component/UserIcon';
import type { DateValue } from '@core/util/date';
import { Entity, type EntityData } from '@entity';
import { Show } from 'solid-js';

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
      class="flex items-center gap-2 min-h-10 px-6 text-sm hover:bg-hover w-full"
    >
      <div class="size-4 shrink-0">
        <Entity.Icon entity={props.entity} />
      </div>
      <span class="ph-no-capture font-semibold truncate flex-1 min-w-0">
        <Entity.Title entity={props.entity} />
      </span>
      <Show when={props.senderId}>
        {(id) => (
          <div class="shrink-0">
            <UserIcon id={id()} size="sm" suppressClick showTooltip />
          </div>
        )}
      </Show>
      <span class="text-xs text-ink-extra-muted font-light shrink-0">
        <Entity.Timestamp
          entity={props.entity}
          overrideTimeStamp={props.timestamp ?? undefined}
        />
      </span>
    </Entity.Root>
  );
}
