import { DateTimeRange } from '@app/components/date-time-range/date-time-range-fields';
import { MobileEndTime } from '@app/components/date-time-range/mobile-time-input/MobileEndTime';
import { MobileStartTime } from '@app/components/date-time-range/mobile-time-input/MobileStartTime';
import { t } from '@app/lib/i18n';
import { SheetGroup } from '@components/app/mobile/sheet-group/SheetGroup';
import { SheetRow } from '@components/app/mobile/sheet-row/SheetRow';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import { ToggleSwitch } from '@ui';
import { Show } from 'solid-js';
import { ComposerRecurrence } from '../../../components/composer/recurrence/ComposerRecurrence';
import { CustomRecurrence } from '../../../components/composer/recurrence/CustomRecurrence';
import { ComposerRangeFeedback } from '../../../components/composer/when/ComposerRangeFeedback';
import { useCalendarComposer } from '../../../context/calendar-composer-context';

/** The 2J two-row date/time grid; one shared range model owns every edit. */
export function MobileComposerWhen() {
  const model = useCalendarComposer();
  const sameDay = () =>
    model.state().start.slice(0, 10) === model.state().end.slice(0, 10);
  return (
    <DateTimeRange.Root {...model.range}>
      <SheetGroup>
        <SheetRow icon={<ClockIcon class="size-4" />} class="items-start py-3">
          <div class="flex flex-col gap-2">
            <DateTimeRange.Dates layout="columns" />
            <Show when={!model.state().allDay}>
              <div class="grid grid-cols-[110px_24px_110px] items-center">
                <MobileStartTime />
                <span
                  aria-hidden="true"
                  class="col-start-2 flex justify-center"
                >
                  <Show when={sameDay()}>
                    <ArrowRightIcon class="size-3 text-ink-extra-muted" />
                  </Show>
                </span>
                <MobileEndTime />
              </div>
            </Show>
          </div>
        </SheetRow>
        <SheetRow>
          <ToggleSwitch
            class="min-h-11 w-full flex-row-reverse justify-between"
            size="md"
            label={t('calendar.allDay')}
            labelClass="text-base text-ink"
            checked={model.state().allDay}
            disabled={model.fieldIsDisabled('allDay')}
            onChange={model.controller.setAllDay}
          />
        </SheetRow>
        <SheetRow label={t('calendar.composerRepeats')}>
          <ComposerRecurrence />
        </SheetRow>
        <Show when={model.controller.recurrenceChoice() === 'custom'}>
          <SheetRow class="py-3">
            <CustomRecurrence
              value={model.controller.customConfig()}
              start={model.controller.startForRecurrence()}
              allDay={model.state().allDay}
              disabled={
                model.fieldIsDisabled('recurrence') ||
                Boolean(model.recurrenceScopeReason())
              }
              onChange={model.controller.setCustomConfig}
            />
          </SheetRow>
        </Show>
      </SheetGroup>
      <ComposerRangeFeedback />
    </DateTimeRange.Root>
  );
}
