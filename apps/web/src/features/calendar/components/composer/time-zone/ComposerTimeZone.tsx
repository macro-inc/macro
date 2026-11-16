import { TimezoneSelect } from '@app/components/timezone-select/TimezoneSelect';
import { timezoneOptions } from '@app/components/timezone-select/timezone-options';
import { t } from '@app/lib/i18n';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerTimeZone() {
  const model = useCalendarComposer();
  const options = timezoneOptions();
  return (
    <Show when={!model.state().allDay || model.isOutOfOffice()}>
      <TimezoneSelect
        value={model.timeZone()}
        onChange={model.setTimeZone}
        options={options}
        disabled={model.timeZoneIsDisabled()}
        label={t('calendar.timeZone')}
        appearance="value"
        portalScope="local"
      />
    </Show>
  );
}
