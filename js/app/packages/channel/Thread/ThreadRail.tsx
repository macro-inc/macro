import { cn } from '@ui';

interface ThreadRailProps {
  newMessage?: boolean;
}

export function ThreadRail(props: ThreadRailProps) {
  return (
    <div
      class={cn(
        'pointer-events-none absolute top-0 bottom-0 border-l border-edge-muted -z-1',
        props.newMessage && 'border-accent'
      )}
      style={{
        left: 'var(--left-of-connector)',
      }}
    />
  );
}
