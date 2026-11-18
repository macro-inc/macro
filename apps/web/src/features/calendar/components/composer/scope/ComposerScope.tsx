import { t } from '@app/lib/i18n';
import { RadioGroup } from '@ui';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

export function ComposerScope() {
  const model = useCalendarComposer();
  return (
    <Show when={model.options.showRecurringEditNotice}>
      <div class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm text-ink-muted">
        <span>{t('calendar.applyChangesTo')}</span>
        <RadioGroup
          size="sm"
          value={model.editScope()}
          disabled={model.formIsDisabled()}
          aria-label={t('calendar.applyChangesTo')}
          class="flex-row gap-3"
          onChange={(scope) => {
            if (scope === 'this_event' || scope === 'all')
              model.changeEditScope(scope);
          }}
        >
          <RadioGroup.Item value="this_event" class="min-h-8 gap-1.5">
            <RadioGroup.ItemControl />
            <RadioGroup.ItemLabel>
              {t('calendar.thisEvent')}
            </RadioGroup.ItemLabel>
          </RadioGroup.Item>
          <RadioGroup.Item value="all" class="min-h-8 gap-1.5">
            <RadioGroup.ItemControl />
            <RadioGroup.ItemLabel>
              {t('calendar.allEvents')}
            </RadioGroup.ItemLabel>
          </RadioGroup.Item>
        </RadioGroup>
      </div>
    </Show>
  );
}
