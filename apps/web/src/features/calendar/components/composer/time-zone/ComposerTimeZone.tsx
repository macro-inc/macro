import { TimezoneSelect } from '@app/components/timezone-select/TimezoneSelect';
import { timezoneOptions } from '@app/components/timezone-select/timezone-options';
import { formatLocale, t } from '@app/lib/i18n';
import { createMemo, Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { useComposerWhenOptional } from '../../../context/composer-when-context';

export function ComposerTimeZone(
  props: { fullWidth?: boolean; ghost?: boolean; size?: 'sm' | 'md' } = {}
) {
  const model = useCalendarComposer();
  const when = useComposerWhenOptional();
  const options = timezoneOptions();
  const selectionLabel = createMemo(
    () =>
      new Intl.DateTimeFormat(formatLocale(), {
        timeZone: model.timeZone(),
        timeZoneName: 'short',
      })
        .formatToParts(new Date())
        .find((part) => part.type === 'timeZoneName')?.value ?? model.timeZone()
  );
  return (
    <Show when={!model.state().allDay}>
      <TimezoneSelect
        value={model.timeZone()}
        onChange={model.setTimeZone}
        options={options}
        disabled={model.timeZoneIsDisabled()}
        label={t('calendar.timeZone')}
        selectionLabel={selectionLabel()}
        appearance={props.ghost ? 'ghost' : 'value'}
        open={when ? when.state.active === 'time-zone' : undefined}
        onOpenChange={(open) => {
          if (!when) return;
          if (open) when.open('time-zone');
          else when.close('time-zone');
        }}
        size={props.size}
        fullWidth={props.fullWidth}
        portalScope="local"
      />
    </Show>
  );
}
