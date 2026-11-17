import { TimezoneSelect } from '@app/components/timezone-select/TimezoneSelect';
import { timezoneOptions } from '@app/components/timezone-select/timezone-options';
import { formatLocale, t } from '@app/lib/i18n';
import { createMemo, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerTimeZone() {
  const model = useCalendarComposer();
  const options = timezoneOptions();
  const selectionLabel = createMemo(
    () =>
      new Intl.DateTimeFormat(formatLocale(), {
        timeZone: model.timeZone(),
        timeZoneName: 'longGeneric',
      })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? model.timeZone()
  );
  return (
    <Show when={!model.state().allDay || model.isOutOfOffice()}>
      <TimezoneSelect
        value={model.timeZone()}
        onChange={model.setTimeZone}
        options={options}
        disabled={model.timeZoneIsDisabled()}
        label={t('calendar.timeZone')}
        selectionLabel={selectionLabel()}
        appearance="value"
        portalScope="local"
      />
    </Show>
  );
}
