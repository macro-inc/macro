import { cn } from '@ui/utils/classname';

interface ThreadRailProps {
  newMessage?: boolean;
}

export function ThreadRail(props: ThreadRailProps) {
  return (
    <div
      class={cn(
        'pointer-events-none absolute top-0 bottom-0 channel-rail-left border-rail -z-1',
        props.newMessage && 'border-accent'
      )}
      style={{
        left: 'var(--left-of-channel-rail)',
      }}
    />
  );
}
