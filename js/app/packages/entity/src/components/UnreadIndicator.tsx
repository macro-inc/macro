import { cn } from '@ui/utils/classname';

export function UnreadIndicator(props: { active?: boolean }) {
  return (
    <div
      class={cn({
        'bg-accent rounded-full size-2': true,
        'opacity-0': !props.active,
      })}
    />
  );
}
