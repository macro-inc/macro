import type { GuestPolicy } from '@service-storage/generated/schemas/guestPolicy';
import { Checkbox } from '@ui';
import { createUniqueId, For, Show } from 'solid-js';

/** Google Calendar's wording and order. */
const GUEST_PERMISSIONS = [
  { key: 'canModify', label: 'Modify event' },
  { key: 'canInviteOthers', label: 'Invite others' },
  { key: 'canSeeOtherGuests', label: 'See guest list' },
] as const satisfies readonly { key: keyof GuestPolicy; label: string }[];

export interface EventGuestPolicyRowProps {
  value: GuestPolicy;
  onChange: (value: GuestPolicy) => void;
  disabled?: boolean;
  /** Why the switches cannot change, shown after them. */
  disabledReason?: string;
}

/**
 * What guests may do with the event. As in Google Calendar, guests who may
 * modify the event may also invite others.
 */
export function EventGuestPolicyRow(props: EventGuestPolicyRowProps) {
  const labelId = `event-guest-permissions-${createUniqueId()}`;
  const reasonId = `${labelId}-reason`;
  const change = (key: keyof GuestPolicy, checked: boolean) => {
    const next = { ...props.value, [key]: checked };
    if (next.canModify) next.canInviteOthers = true;
    props.onChange(next);
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={props.disabledReason ? reasonId : undefined}
      class="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted"
    >
      <span id={labelId} class="font-medium">
        Guest permissions
      </span>
      <For each={GUEST_PERMISSIONS}>
        {(permission) => (
          <Checkbox
            checked={props.value[permission.key]}
            onChange={(checked) => change(permission.key, checked)}
            disabled={
              props.disabled ||
              (permission.key === 'canInviteOthers' && props.value.canModify)
            }
            class="touch:min-h-[44px]"
          >
            <Checkbox.Control />
            <Checkbox.Label>{permission.label}</Checkbox.Label>
          </Checkbox>
        )}
      </For>
      <Show when={props.disabledReason}>
        {(reason) => (
          <span id={reasonId} class="text-ink-extra-muted">
            {reason()}
          </span>
        )}
      </Show>
    </div>
  );
}
