import { cn } from "@ui/utils/classname";

interface ThreadRailProps {
  new?: boolean;
}

export function ThreadRail(props: ThreadRailProps) {
  return (
    <div
      class={cn("pointer-events-none absolute top-0 bottom-0 border-l border-edge-muted/60", props.new && 'border-accent')}
      style={{
        left: 'var(--left-of-connector)',
      }}
    />
  )
}
