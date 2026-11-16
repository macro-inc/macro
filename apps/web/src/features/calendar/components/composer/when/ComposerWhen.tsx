import { DateTimeRange } from '@app/components/date-time-range/date-time-range-fields';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { ComposerDuration } from './ComposerDuration';

export function ComposerWhen() {
  const model = useCalendarComposer();
  return (
    <DateTimeRange.Root {...model.range}>
      <div class="flex min-w-0 flex-wrap items-center gap-1">
        <DateTimeRange.StartDate />
        <DateTimeRange.StartTime />
        <span aria-hidden="true" class="text-ink-extra-muted">
          –
        </span>
        <DateTimeRange.EndDate />
        <DateTimeRange.EndTime />
        <ComposerDuration />
      </div>
    </DateTimeRange.Root>
  );
}
