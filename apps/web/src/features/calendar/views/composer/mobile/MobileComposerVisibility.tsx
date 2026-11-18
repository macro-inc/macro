import { t } from '@app/lib/i18n';
import EyeIcon from '@icon/system/regular/eye.svg';
import { For } from 'solid-js';
import { PhoneMenu } from '../../../components/composer/phone-menu/PhoneMenu';
import { PhoneMenuChoice } from '../../../components/composer/phone-menu/PhoneMenuChoice';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { usePhoneComposerMenu } from '../../../context/phone-composer-menu-context';

export function MobileComposerVisibility() {
  const model = useCalendarComposer();
  const menus = usePhoneComposerMenu();
  const choices = () =>
    [
      { value: 'default', label: t('calendar.visibilityDefault') },
      { value: 'public', label: t('calendar.visibilityPublic') },
      { value: 'private', label: t('calendar.visibilityPrivate') },
    ] as const;
  const selected = () =>
    model.visibility() === 'confidential' ? 'private' : model.visibility();
  const label = () => {
    if (model.options.visibilityReadOnlyReason) return t('calendar.visibility');
    if (model.editScope() === 'this_event')
      return t('calendar.visibilityUnavailable');
    return (
      choices().find((choice) => choice.value === selected())?.label ??
      t('calendar.visibility')
    );
  };
  return (
    <PhoneMenu
      menu="visibility"
      title={t('calendar.visibility')}
      icon={<EyeIcon class="size-4" />}
      value={label()}
      disabled={model.visibilityIsDisabled()}
    >
      <For each={choices()}>
        {(choice) => (
          <PhoneMenuChoice
            label={choice.label}
            selected={choice.value === selected()}
            onChoose={() => {
              model.setVisibility(choice.value);
              menus.close();
            }}
          />
        )}
      </For>
    </PhoneMenu>
  );
}
