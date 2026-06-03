import { NotificationRow } from '@entity';
import type { UnifiedNotification } from '@notifications';
import { cn } from '@ui';

interface NotificationListEntityProps {
  notification: UnifiedNotification;
  highlighted?: boolean;
  stacked?: boolean;
}

export function NotificationListEntity(props: NotificationListEntityProps) {
  return (
    <div
      class={cn(
        '@container/entity relative group/narrow flex flex-col min-h-10',
        props.stacked
          ? 'w-full'
          : 'soup-list-entity rounded-lg w-[calc(100%-0.5rem)] mr-1 py-0.5 mx-1',
        props.highlighted && 'ring ring-edge bg-active/60 ring-inset'
      )}
    >
      <NotificationRow
        notification={props.notification}
        variant="compact"
        class={cn(!props.stacked && 'rounded-lg')}
      />
    </div>
  );
}
