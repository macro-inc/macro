import { DateTimeRange } from '@app/components/date-time-range/date-time-range-fields';
import { EventFormParts } from '../../../components/composer/event-form-parts';
import { EventFieldLock } from '../../../components/composer/field-lock/EventFieldLock';
import { useEventForm } from '../../../context/event-form-context';
import { EventDuration } from './EventDuration';

/** Compose the shared date/time fields without the phone row layout. */
export function DesktopEventWhen() {
  const form = useEventForm();
  return (
    <div class="flex min-w-0 flex-col gap-1">
      <EventFieldLock
        reason={form.props.detailsReadOnlyReason}
        class="block min-w-0"
      >
        <DateTimeRange.Root {...form.range}>
          <div class="flex min-w-0 flex-wrap items-center gap-1">
            <DateTimeRange.StartDate />
            <DateTimeRange.StartTime />
            <span aria-hidden="true" class="text-ink-extra-muted">
              –
            </span>
            <DateTimeRange.EndDate />
            <DateTimeRange.EndTime />
            <EventDuration />
          </div>
        </DateTimeRange.Root>
      </EventFieldLock>
      <EventFormParts.RangeMessages />
    </div>
  );
}
