import { formatTimeZoneAbbreviation } from '@core/util/date';
import ClockIcon from '@phosphor/clock.svg';
import HashIcon from '@phosphor/hash.svg';
import UserPlus from '@phosphor/user-plus.svg';
import { cn, HoverCard } from '@ui';
import { differenceInCalendarDays } from 'date-fns/differenceInCalendarDays';
import { format } from 'date-fns/format';
import { isThisYear } from 'date-fns/isThisYear';
import { isToday } from 'date-fns/isToday';
import { isTomorrow } from 'date-fns/isTomorrow';
import type { ParentProps } from 'solid-js';
import { OwnerLabel } from '../owner/owner-display';
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

export function SharedBadge(props: { ownerId: string }) {
  return (
    <Badge class="text-ink-extra-muted border-edge-muted pr-2 max-w-48 min-w-0">
      <span class="flex min-w-0 normal-case font-sans">
        <OwnerLabel ownerId={props.ownerId} userAvatarOnly />
      </span>
      shared
    </Badge>
  );
}

export function SharedBadgeSmall(props: { ownerId: string }) {
  return (
    <HoverCard
      content={
        <div class="flex items-center gap-1.5 text-xs">
          <OwnerLabel
            ownerId={props.ownerId}
            suppressClick
            showTooltip={false}
          />
          <span>shared this with you</span>
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
  return (
    <HoverCard
      content={
        <div class="flex items-center gap-1.5 text-xs">
          <span>Created by</span>
          <OwnerLabel
            ownerId={props.ownerId}
            suppressClick
            showTooltip={false}
          />
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

function scheduledSendLabel(time: Date): string {
  const clock = format(time, 'h:mm a');
  if (isToday(time)) return `Today, ${clock}`;
  if (isTomorrow(time)) return `Tomorrow, ${clock}`;
  // Only an upcoming send reads as a weekday; an overdue one keeps its date.
  const daysAway = differenceInCalendarDays(time, new Date());
  if (daysAway > 0 && daysAway < 7) return format(time, 'EEE, h:mm a');
  if (isThisYear(time)) return format(time, 'MMM d, h:mm a');
  return format(time, 'MMM d, yyyy');
}

/** When a scheduled row sends; list layouts show it in the timestamp slot. */
export function ScheduledBadge(props: { sendTime: string }) {
  const sendTime = () => new Date(props.sendTime);
  const overdue = () => sendTime().getTime() <= Date.now();
  return (
    <Badge
      class={cn(
        'ml-auto w-fit shrink-0 px-2',
        overdue()
          ? 'text-failure border-failure/20'
          : 'text-accent border-accent/20'
      )}
      title={[
        overdue() ? 'Overdue scheduled send' : 'Scheduled to send',
        format(sendTime(), "EEE, MMM d, yyyy 'at' h:mm a"),
        formatTimeZoneAbbreviation(sendTime()),
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <ClockIcon class="size-3" />
      <span class="whitespace-nowrap">{scheduledSendLabel(sendTime())}</span>
    </Badge>
  );
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
