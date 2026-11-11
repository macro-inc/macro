import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
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

/** As in Google Calendar, guests who may modify the event may also invite others. */
function createGuestPolicyEditor(props: EventGuestPolicyRowProps) {
  const labelId = `event-guest-permissions-${createUniqueId()}`;
  return {
    labelId,
    reasonId: `${labelId}-reason`,
    change: (key: keyof GuestPolicy, checked: boolean) => {
      const next = { ...props.value, [key]: checked };
      if (next.canModify) next.canInviteOthers = true;
      props.onChange(next);
    },
    isDisabled: (key: keyof GuestPolicy) =>
      props.disabled === true ||
      (key === 'canInviteOthers' && props.value.canModify),
  };
}

/** What guests may do with the event, on one line. */
export function EventGuestPolicyRow(props: EventGuestPolicyRowProps) {
  const { labelId, reasonId, change, isDisabled } =
    createGuestPolicyEditor(props);

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
            disabled={isDisabled(permission.key)}
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

/** What guests may do with the event, one permission per row, for a touch sheet. */
export function EventGuestPolicyRows(props: EventGuestPolicyRowProps) {
  const { labelId, reasonId, change, isDisabled } =
    createGuestPolicyEditor(props);

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={props.disabledReason ? reasonId : undefined}
      class="flex min-w-0 flex-col gap-1"
    >
      <span id={labelId} class="px-4 text-xs font-medium text-ink-muted">
        Guest permissions
      </span>
      <MobileDrawer.Section class="mx-0">
        <For each={GUEST_PERMISSIONS}>
          {(permission) => (
            <Checkbox
              checked={props.value[permission.key]}
              onChange={(checked) => change(permission.key, checked)}
              disabled={isDisabled(permission.key)}
              class="min-h-11 w-full justify-between px-3"
            >
              <Checkbox.Label class="text-sm text-ink">
                {permission.label}
              </Checkbox.Label>
              <Checkbox.Control />
            </Checkbox>
          )}
        </For>
      </MobileDrawer.Section>
      <Show when={props.disabledReason}>
        {(reason) => (
          <span id={reasonId} class="px-4 text-xs text-ink-extra-muted">
            {reason()}
          </span>
        )}
      </Show>
    </div>
  );
}
