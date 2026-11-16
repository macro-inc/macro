import { t } from '@app/lib/i18n';
import { Match, Switch } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerRangeFeedback() {
  const model = useCalendarComposer();
  return (
    <Switch>
      <Match when={model.controller.dateRangeError()}>
        {(error) => (
          <p
            id={model.ids.dateRangeError}
            role="alert"
            class="text-xs text-failure"
          >
            {error()}
          </p>
        )}
      </Match>
      <Match when={model.timeZoneRangeInvalid()}>
        <p
          id={model.ids.dateRangeError}
          role="alert"
          class="text-xs text-failure"
        >
          {t('calendar.invalidTimeZoneRange')}
        </p>
      </Match>
      <Match when={model.pastEventWarning()}>
        {(warning) => (
          <p
            id={model.ids.pastEventWarning}
            role="status"
            class="text-xs text-warning"
          >
            {warning()}
          </p>
        )}
      </Match>
    </Switch>
  );
}
