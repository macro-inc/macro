import { TimezoneSelect } from '@app/components/timezone-select/TimezoneSelect';
import {
  shortTimeZoneLabel,
  timezoneOptions,
} from '@app/components/timezone-select/timezone-options';
import { formatLocale, t } from '@app/lib/i18n';
import { createMemo, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerTimeZone(
  props: { ghost?: boolean; size?: 'sm' | 'md' } = {}
) {
  const model = useCalendarComposer();
  const when = model.when;
  const options = createMemo(() => timezoneOptions(undefined, formatLocale()));
  const selectionLabel = createMemo(() =>
    shortTimeZoneLabel(model.timeZone(), formatLocale())
  );
  return (
    <Show when={!model.state().allDay}>
      <TimezoneSelect
        value={model.timeZone()}
        onChange={model.setTimeZone}
        options={options()}
        disabled={model.timeZoneIsDisabled()}
        label={t('calendar.timeZone')}
        selectionLabel={selectionLabel()}
        appearance={props.ghost ? 'ghost' : 'value'}
        open={when.state.active === 'time-zone'}
        onOpenChange={(open) => {
          if (open) when.open('time-zone');
          else when.close('time-zone');
        }}
        size={props.size}
        portalScope="local"
      />
    </Show>
  );
}
