import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { Dropdown } from '@ui';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerBusy() {
  const model = useCalendarComposer();
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        variant="value"
        finish="flat"
        size="md"
        disabled={model.transparencyIsDisabled()}
        aria-label={t('calendar.availability')}
      >
        {model.transparency() === 'transparent'
          ? t('calendar.free')
          : t('calendar.busy')}
        <CaretDownIcon class="size-3.5" />
      </Dropdown.Trigger>
      <Dropdown.Content portalScope="local" class="min-w-40">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={model.transparency() ?? 'opaque'}
            onChange={(value) => {
              if (value === 'opaque' || value === 'transparent')
                model.setTransparency(value);
            }}
          >
            <Dropdown.RadioItem value="opaque" closeOnSelect>
              {t('calendar.busy')}
              <Dropdown.ItemIndicator />
            </Dropdown.RadioItem>
            <Dropdown.RadioItem value="transparent" closeOnSelect>
              {t('calendar.free')}
              <Dropdown.ItemIndicator />
            </Dropdown.RadioItem>
          </Dropdown.RadioGroup>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
