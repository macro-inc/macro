import { cn } from '@ui/utils/classname';

export function UnreadIndicator(props: { class?: string; active?: boolean }) {
  return (
    <div
      class={cn(
        'bg-accent rounded-full size-2 shrink-0',
        !props.active && 'opacity-0',
        props.class
      )}
    />
  );
}
