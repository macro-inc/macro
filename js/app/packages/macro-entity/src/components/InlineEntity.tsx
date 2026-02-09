import { createMemo } from 'solid-js';
import type { EntityData } from '../types/entity';
import { getEntityIconConfig } from '@core/component/EntityIcon';
import { cn } from '@ui/utils/classname';
import { Dynamic } from 'solid-js/web';

export function InlineEntity(props: { entity: EntityData }) {
  const iconConfig = createMemo(() => getEntityIconConfig(props.entity));

  return (
    <div class="flex items-center gap-2 min-w-0">
      <Dynamic
        component={iconConfig().icon}
        class={cn('flex shrink-0 size-[1em]', iconConfig().foreground)}
      />
      <span class="truncate">{props.entity.name}</span>
    </div>
  );
}
