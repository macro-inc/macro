import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Dropdown } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { eventKindLabel } from '../out-of-office';

export function ComposerKind() {
  const model = useCalendarComposer();
  const changeKind = (value: string) => {
    if (model.isEdit()) return;
    if (value === 'default' || value === 'out_of_office') {
      model.controller.setEventKind(value);
    }
  };
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="value"
        finish="flat"
        size="sm"
        aria-label={t('calendar.eventKind')}
        disabled={
          model.formIsDisabled() || model.isEdit() || model.detailsLocked()
        }
      >
        {eventKindLabel(model.state().eventType)}
        <CaretDownIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-40">
        <Dropdown.RadioGroup
          value={model.controller.eventKind()}
          onChange={changeKind}
        >
          <Dropdown.RadioItem value="default" closeOnSelect>
            <span class="flex-1">{t('calendar.eventKindEvent')}</span>
            <Dropdown.ItemIndicator />
          </Dropdown.RadioItem>
          <Dropdown.RadioItem value="out_of_office" closeOnSelect>
            <span class="flex-1">{t('calendar.eventKindOutOfOffice')}</span>
            <Dropdown.ItemIndicator />
          </Dropdown.RadioItem>
        </Dropdown.RadioGroup>
      </Dropdown.Content>
    </Dropdown>
  );
}
