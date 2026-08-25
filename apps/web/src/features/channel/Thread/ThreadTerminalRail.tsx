import { cn } from '@ui';

type ThreadTerminalRailProps = {
  newMessage?: boolean;
};

/** Curves the parent spine toward the reply action without touching it. */
export function ThreadTerminalRail(props: ThreadTerminalRailProps) {
  return (
    <div
      class={cn(
        'pointer-events-none absolute -z-1 channel-rail-left channel-rail-bottom border-rail rounded-bl-[14px] left-(--left-of-channel-rail) h-8',
        props.newMessage && 'border-accent'
      )}
      style={{
        bottom: 'calc(var(--thread-padding-y) + 1.5rem)',
        width:
          'calc(var(--thread-shift) - var(--user-icon-width) / 2 - var(--channel-rail-clearance))',
      }}
    />
  );
}
