import { createMemo } from 'solid-js';
import type { EntityData } from '../types/entity';
import { getIconConfig } from '@core/component/EntityIcon';
import { cn } from '@ui/utils/classname';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';

export function InlineEntity(props: { entity: EntityData }) {
  const iconConfig = createMemo<ReturnType<typeof getIconConfig>>(() => {
    return match(props.entity)
      .with({ type: 'channel', channelType: 'direct_message' }, () =>
        getIconConfig('directMessage')
      )
      .with({ type: 'channel', channelType: 'organization' }, () =>
        getIconConfig('company')
      )
      .with({ type: 'channel' }, () => getIconConfig('channel'))
      .with({ type: 'document' }, (entity) =>
        getIconConfig(entity.subType?.type ?? entity.fileType ?? 'default')
      )
      .with({ type: 'email', isRead: true }, () => getIconConfig('emailRead'))
      .with({ type: 'email' }, () => getIconConfig('email'))
      .otherwise((entity) => getIconConfig(entity.type));
  });

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
