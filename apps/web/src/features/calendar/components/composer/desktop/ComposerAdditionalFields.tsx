import BellIcon from '@icon/system/regular/bell-simple.svg';
import VisibilityIcon from '@icon/system/regular/eye.svg';
import ShieldIcon from '@icon/system/regular/shield-check.svg';
import DescriptionIcon from '@icon/system/regular/text-align-left.svg';
import { type ComponentProps, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import type { ComposerDescription } from '../parts/ComposerDescription';
import { ComposerFieldRow } from '../parts/ComposerFieldRow';
import { ComposerGuestPermissions } from '../parts/ComposerGuestPermissions';
import { ComposerReminders } from '../parts/ComposerReminders';
import { ComposerVisibility } from '../parts/ComposerVisibility';
import { DesktopOptionalField } from '../parts/DesktopOptionalField';

export function ComposerAdditionalFields(props: {
  resolveAppLink?: ComponentProps<typeof ComposerDescription>['resolveAppLink'];
}) {
  const model = useCalendarComposer(),
    controller = model.controller;
  const descriptionInMainFields =
    !model.isEdit() || Boolean(controller.initialValue().description);
  return (
    <>
      <Show when={!descriptionInMainFields && !model.isOutOfOffice()}>
        <ComposerFieldRow icon={<DescriptionIcon class="size-4" />}>
          <DesktopOptionalField
            field="description"
            resolveAppLink={props.resolveAppLink}
          />
        </ComposerFieldRow>
      </Show>
      <ComposerFieldRow icon={<BellIcon class="size-4" />}>
        <ComposerReminders
          minutes={controller.reminderMinutes()}
          canAdd={controller.canAddReminder()}
          preservedCount={controller.preservedReminderCount()}
          disabled={model.fieldIsDisabled('reminders')}
          onChange={controller.setReminderMinutes}
        />
      </ComposerFieldRow>
      <Show when={model.showsGuestPolicy()}>
        <ComposerFieldRow icon={<ShieldIcon class="size-4" />}>
          <ComposerGuestPermissions {...model.guestPolicy} />
        </ComposerFieldRow>
      </Show>
      <ComposerFieldRow icon={<VisibilityIcon class="size-4" />}>
        <ComposerVisibility />
      </ComposerFieldRow>
    </>
  );
}
