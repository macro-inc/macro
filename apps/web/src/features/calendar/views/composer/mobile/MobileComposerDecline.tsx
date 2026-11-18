import { t } from '@app/lib/i18n';
import { For } from 'solid-js';
import { PhoneMenu } from '../../../components/composer/phone-menu/PhoneMenu';
import { PhoneMenuChoice } from '../../../components/composer/phone-menu/PhoneMenuChoice';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';

export function MobileComposerDecline() {
  const model = useCalendarComposer();
  const menus = usePhoneComposerMenu();
  const modes = () =>
    [
      {
        value: 'decline_only_new_conflicting_invitations',
        label: t('calendar.declineNew'),
      },
      {
        value: 'decline_all_conflicting_invitations',
        label: t('calendar.declineAll'),
      },
      { value: 'decline_none', label: t('calendar.declineNone') },
    ] as const;
  return (
    <PhoneMenu
      menu="decline"
      title={t('calendar.declineMode')}
      disabled={model.fieldIsDisabled('outOfOffice')}
      value={
        modes().find(
          (mode) => mode.value === model.state().outOfOffice?.autoDeclineMode
        )?.label ?? t('calendar.declineMode')
      }
    >
      <For each={modes()}>
        {(mode) => (
          <PhoneMenuChoice
            label={mode.label}
            selected={mode.value === model.state().outOfOffice?.autoDeclineMode}
            onChoose={() => {
              model.controller.setOutOfOffice({
                autoDeclineMode: mode.value,
                declineMessage: model.state().outOfOffice?.declineMessage ?? '',
              });
              menus.close();
            }}
          />
        )}
      </For>
    </PhoneMenu>
  );
}
