import { cn } from '@ui';

type ThreadRepliesBridgeRailProps = {
  /** An unread thread paints its complete rail path with the accent. */
  newMessage?: boolean;
};

/** Connects the root-message rail to the first reply across the reply padding. */
export function ThreadRepliesBridgeRail(props: ThreadRepliesBridgeRailProps) {
  return (
    <div
      class={cn(
        'pointer-events-none absolute top-0 -z-1 channel-rail-left border-rail left-(--left-of-channel-rail) h-(--thread-padding-y)',
        props.newMessage && 'border-accent'
      )}
    />
  );
}
