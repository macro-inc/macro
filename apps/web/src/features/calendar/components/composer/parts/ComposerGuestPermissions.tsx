import { t } from '@app/lib/i18n';
import type { GuestPolicy } from '@service-storage/generated/schemas/guestPolicy';
import { Checkbox } from '@ui';
import { createUniqueId, For, Show } from 'solid-js';
import { createComposerGuestPermissions } from '../../../primitives/create-composer-guest-permissions';

const PERMISSIONS = [
  { key: 'canModify', label: 'calendar.modifyEvent' },
  { key: 'canInviteOthers', label: 'calendar.inviteOthers' },
  { key: 'canSeeOtherGuests', label: 'calendar.seeGuestList' },
] as const;

export interface ComposerGuestPermissionsProps {
  value: GuestPolicy;
  onChange: (value: GuestPolicy) => void;
  disabled?: boolean;
  disabledReason?: string;
}

export function ComposerGuestPermissions(props: ComposerGuestPermissionsProps) {
  const id = createUniqueId();
  const permissions = createComposerGuestPermissions({
    value: () => props.value,
    disabled: () => props.disabled ?? false,
    onChange: (value) => props.onChange(value),
  });
  return (
    <div
      role="group"
      class="flex flex-col gap-2"
      aria-labelledby={id}
      aria-describedby={props.disabledReason ? `${id}-reason` : undefined}
    >
      <div id={id} class="text-sm text-ink-muted">
        {t('calendar.guestPermissions')}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-2">
        <For each={PERMISSIONS}>
          {(permission) => (
            <Checkbox
              checked={props.value[permission.key]}
              disabled={permissions.isDisabled(permission.key)}
              onChange={(checked) =>
                permissions.change(permission.key, checked)
              }
            >
              <Checkbox.Control />
              <Checkbox.Label>{t(permission.label)}</Checkbox.Label>
            </Checkbox>
          )}
        </For>
      </div>
      <Show when={props.disabledReason}>
        {(reason) => (
          <p id={`${id}-reason`} class="text-xs text-ink-muted">
            {reason()}
          </p>
        )}
      </Show>
    </div>
  );
}
