import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import UserPlus from '@phosphor/user-plus.svg';
import { cn, HoverCard } from '@ui';
import type { ParentProps } from 'solid-js';

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

export function SharedBadgeSmall(props: { ownerId: string }) {
  const id = () => tryMacroId(props.ownerId);
  const name = () => {
    const currentId = id();
    if (currentId) {
      let [name] = useDisplayName(currentId);
      return name;
    }
    return () => undefined;
  };

  return (
    <HoverCard
      content={
        <div class="flex items-center gap-1.5 text-xs">
          <UserIcon
            id={props.ownerId}
            size="sm"
            suppressClick
            showTooltip={false}
          />
          <span>{name()()} shared this with you</span>
        </div>
      }
    >
      <div class="text-ink-extra-muted/50 p-1">
        <UserPlus class="size-4" />
      </div>
    </HoverCard>
  );
}

export function CreatedByBadgeSmall(props: { ownerId: string }) {
  const id = () => tryMacroId(props.ownerId);
  const name = () => {
    const currentId = id();
    if (currentId) {
      let [name] = useDisplayName(currentId);
      return name;
    }
    return () => undefined;
  };

  return (
    <HoverCard
      content={
        <div class="flex items-center gap-1.5 text-xs">
          <UserIcon
            id={props.ownerId}
            size="sm"
            suppressClick
            showTooltip={false}
          />
          <span>Created by {name()()}</span>
        </div>
      }
    >
      <div class="text-ink-extra-muted/50 p-1">
        <UserPlus class="size-4" />
      </div>
    </HoverCard>
  );
}

export function DraftBadge() {
  return <Badge class="text-accent-30 border-edge-muted px-2">draft</Badge>;
}

function _ImportantBadge() {
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
