import { type DateValue, formatDate } from '@core/util/date';
import { OwnerLabel } from '@entity/owner/owner-display';
import CalendarIcon from '@icon/system/regular/calendar-dots.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import UserIcon from '@icon/system/regular/user.svg';
import { type JSX, type ParentProps, Show } from 'solid-js';

export function EntityMetadataRow(
  props: ParentProps<{ icon: JSX.Element; label: string }>
) {
  return (
    <div class="flex min-w-0 items-center gap-3">
      <span class="flex shrink-0 items-center gap-2 whitespace-nowrap">
        {props.icon}
        {props.label}
      </span>
      <div class="min-w-0 flex-1 wrap-break-word">{props.children}</div>
    </div>
  );
}

/** Quiet metadata copy shared by every block information panel. */
export function EntityMetadata(
  props: ParentProps<{
    ownerId?: string | null;
    createdAt?: DateValue | null;
    updatedAt?: DateValue | null;
  }>
) {
  return (
    <div class="flex flex-col gap-1">
      <Show when={props.ownerId}>
        {(owner) => (
          <EntityMetadataRow icon={<UserIcon class="size-3.5" />} label="Owner">
            <OwnerLabel ownerId={owner()} textOnly suppressClick />
          </EntityMetadataRow>
        )}
      </Show>
      <Show when={props.createdAt}>
        {(created) => (
          <EntityMetadataRow
            icon={<CalendarIcon class="size-3.5" />}
            label="Created"
          >
            {formatDate(created(), { showTime: true })}
          </EntityMetadataRow>
        )}
      </Show>
      <Show when={props.updatedAt}>
        {(updated) => (
          <EntityMetadataRow
            icon={<ClockIcon class="size-3.5" />}
            label="Last updated"
          >
            {formatDate(updated(), { showTime: true })}
          </EntityMetadataRow>
        )}
      </Show>
      {props.children}
    </div>
  );
}
