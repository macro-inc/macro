import { t } from '@app/lib/i18n';
import { cn } from '@ui';

export function UnreadIndicator(props: { class?: string; active?: boolean }) {
  return (
    <div
      role={props.active ? 'img' : undefined}
      aria-label={props.active ? t('common.unread') : undefined}
      aria-hidden={props.active ? undefined : true}
      class={cn(
        'bg-accent rounded-full size-2 shrink-0',
        !props.active && 'opacity-0',
        props.class
      )}
    />
  );
}
