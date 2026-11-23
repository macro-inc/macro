import { t } from '@app/lib/i18n';
import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import ShieldIcon from '@icon/system/regular/shield-check.svg';
import { Checkbox } from '@ui';
import { For, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { createComposerGuestPermissions } from '../../../primitives/create-composer-guest-permissions';

const PERMISSIONS = [
  { key: 'canModify', label: 'calendar.modifyEvent' },
  { key: 'canInviteOthers', label: 'calendar.inviteOthers' },
  { key: 'canSeeOtherGuests', label: 'calendar.seeGuestList' },
] as const;

export function MobileComposerGuestPermissions() {
  const model = useCalendarComposer();
  const permissions = createComposerGuestPermissions({
    value: () => model.guestPolicy.value,
    disabled: () => model.guestPolicy.disabled,
    onChange: model.guestPolicy.onChange,
  });
  return (
    <SheetGroup aria-label={t('calendar.guestPermissions')}>
      <SheetRow icon={<ShieldIcon class="size-4" />} class="min-h-8">
        <span class="text-xs text-ink-muted">{t('calendar.guestsCan')}</span>
      </SheetRow>
      <For each={PERMISSIONS}>
        {(permission) => (
          <SheetRow>
            <Checkbox
              size="lg"
              class="min-h-11 w-full flex-row-reverse justify-between"
              checked={model.guestPolicy.value[permission.key]}
              disabled={permissions.isDisabled(permission.key)}
              onChange={(checked) =>
                permissions.change(permission.key, checked)
              }
            >
              <Checkbox.Control />
              <Checkbox.Label>{t(permission.label)}</Checkbox.Label>
            </Checkbox>
          </SheetRow>
        )}
      </For>
      <Show when={model.guestPolicy.disabledReason}>
        {(reason) => <p class="px-3 pb-2 text-xs text-ink-muted">{reason()}</p>}
      </Show>
    </SheetGroup>
  );
}
