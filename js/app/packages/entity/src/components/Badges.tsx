import type { ParentProps } from 'solid-js';
import { UserIcon } from '@core/component/UserIcon';
import { cn } from '@ui/utils/classname';

function Badge(props: ParentProps<{ class?: string }>) {
  return (
    <div
      class={cn(
        'font-mono font-medium user-select-none uppercase flex items-center p-0.5 gap-1 text-xxs rounded-full border',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

// TODO (seamus) : tool tip for now, better shared context later
export function SharedBadge(props: { ownerId: string }) {
  return (
    <Badge class="text-ink-extra-muted border-edge-muted pr-2">
      <UserIcon id={props.ownerId} size="sm" />
      shared
    </Badge>
  );
}

export function DraftBadge() {
  return <Badge class="text-accent-30 border-edge-muted px-2">draft</Badge>;
}

export function ImportantBadge() {
  return (
    <Badge class="text-accent bg-accent/10 px-2 border-accent/10">
      important
    </Badge>
  );
}

export function AttendanceBadge(props: { attended: boolean }) {
  return (
    <Badge
      class={
        props.attended
          ? 'text-ink-extra-muted border-edge-muted px-2'
          : 'text-accent-30 border-edge-muted px-2'
      }
    >
      {props.attended ? 'attended' : 'unattended'}
    </Badge>
  );
}
