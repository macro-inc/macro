import { DateTimeRange } from '@app/components/date-time-range/date-time-range-fields';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import { Show } from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { ComposerDuration } from './ComposerDuration';
import { ComposerRangeFeedback } from './ComposerRangeFeedback';

export function ComposerWhen() {
  const model = useCalendarComposer();
  const sameDay = () =>
    model.state().start.slice(0, 10) === model.state().end.slice(0, 10);
  return (
    <DateTimeRange.Root {...model.range}>
      <div class="flex min-w-0 flex-wrap items-center gap-1">
        <DateTimeRange.Dates fieldWidth="110px" />
        <Show when={!model.state().allDay}>
          <div class="grid grid-cols-[110px_20px_110px] items-center">
            <DateTimeRange.StartTime class="w-[110px]" splitMeridiem />
            <span aria-hidden="true" class="flex justify-center">
              <Show when={sameDay()}>
                <ArrowRightIcon class="size-3 text-ink-extra-muted" />
              </Show>
            </span>
            <DateTimeRange.EndTime class="w-[110px]" splitMeridiem />
          </div>
        </Show>
        <ComposerDuration />
      </div>
      <ComposerRangeFeedback />
    </DateTimeRange.Root>
  );
}
