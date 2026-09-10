import { UserIcon } from '@core/component/UserIcon';
import { getDisplayName, tryMacroId } from '@core/user';
import HashIcon from '@phosphor/hash.svg';
import UserPlus from '@phosphor/user-plus.svg';
import { cn, HoverCard } from '@ui';
import type { ParentProps } from 'solid-js';
import type { CallStatus } from '../types/entity';

function Badge(props: ParentProps<{ class?: string; title?: string }>) {
  return (
    <div
      class={cn(
        'font-mono font-medium select-none uppercase flex items-center p-0.5 gap-1 text-xxs rounded-full border',
        props.class
      )}
      title={props.title}
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
  const name = () => getDisplayName(id()) || undefined;

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
          <span>{name()} shared this with you</span>
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
  const name = () => getDisplayName(id()) || undefined;

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
          <span>Created by {name()}</span>
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
  return <Badge class="text-warning border-edge-muted px-2">draft</Badge>;
}

function _ImportantBadge() {
  return (
    <Badge class="text-accent bg-accent/10 px-2 border-accent/10">
      important
    </Badge>
  );
}

type CallStatusBadgeConfig = {
  class: string;
  label: string;
};

function getCallStatusBadgeConfig(status: CallStatus): CallStatusBadgeConfig {
  switch (status) {
    case 'ATTENDED':
      return {
        class: 'text-ink-extra-muted border-edge-muted px-2',
        label: 'attended',
      };
    case 'MISSED':
      return {
        class: 'text-warning border-edge-muted px-2',
        label: 'missed',
      };
    case 'UNATTENDED':
      return {
        class: 'text-ink-extra-muted/70 border-edge-muted px-2',
        label: 'unattended',
      };
  }
}

export function CallStatusBadge(props: { status: CallStatus }) {
  const config = () => getCallStatusBadgeConfig(props.status);

  return <Badge class={config().class}>{config().label}</Badge>;
}

export function CallChannelNameBadge(props: { channelName: string }) {
  return (
    <Badge
      class="ph-no-capture max-w-32 min-w-0 shrink-0 normal-case font-sans text-ink-extra-muted border-edge-muted px-2"
      title={props.channelName}
    >
      <HashIcon class="size-3 shrink-0" />
      <span class="truncate">{props.channelName}</span>
    </Badge>
  );
}

/**
 * What a reminder is about, beside its description.
 *
 * The same shape as {@link CallChannelNameBadge} — a reminder row is named by
 * its own text, so this is the only thing saying which entity it points at.
 * Presentational: the caller resolves the name and supplies the icon, since a
 * reminder can reference any entity type.
 */
export function ReminderReferenceBadge(props: ParentProps<{ name: string }>) {
  return (
    <Badge
      class="ph-no-capture max-w-32 min-w-0 shrink-0 normal-case font-sans text-ink-extra-muted border-edge-muted px-2"
      title={props.name}
    >
      {props.children}
      <span class="truncate">{props.name}</span>
    </Badge>
  );
}

/**
 * How often a recurring reminder fires, e.g. "Every weekday at 9:00 AM".
 *
 * A reminder row shows its next firing in the timestamp column, which for a
 * recurring one says when it next comes due but not that it will come due
 * again. This is the part that says so.
 */
export function ReminderRecurrenceBadge(props: { recurrence: string }) {
  return (
    <Badge
      class="max-w-40 min-w-0 shrink-0 normal-case font-sans text-ink-extra-muted border-edge-muted px-2"
      title={props.recurrence}
    >
      <span class="truncate">{props.recurrence}</span>
    </Badge>
  );
}

export function CallDurationBadge(props: { duration: string }) {
  return (
    <Badge class="normal-case text-ink-extra-muted border-edge-muted px-2">
      {props.duration}
    </Badge>
  );
}

export function AttendanceBadge(props: { attended: boolean }) {
  return (
    <CallStatusBadge status={props.attended ? 'ATTENDED' : 'UNATTENDED'} />
  );
}
