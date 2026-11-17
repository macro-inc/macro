import { DateTimeRange } from '@app/components/date-time-range/date-time-range-fields';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { ComposerDuration } from './ComposerDuration';
import { ComposerRangeFeedback } from './ComposerRangeFeedback';

export function ComposerWhen() {
  const model = useCalendarComposer();
  return (
    <DateTimeRange.Root {...model.range}>
      <div class="flex min-w-0 flex-wrap items-center gap-1">
        <DateTimeRange.Dates />
        <DateTimeRange.StartTime class="w-[4.25rem]" />
        <span
          aria-hidden="true"
          class="text-ink-extra-muted"
          hidden={model.state().allDay}
        >
          –
        </span>
        <DateTimeRange.EndTime class="w-[4.25rem]" />
        <ComposerDuration />
      </div>
      <ComposerRangeFeedback />
    </DateTimeRange.Root>
  );
}
